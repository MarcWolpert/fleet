#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Make programs copied into Fleet.app use libraries copied beside them (#359).

relocate.py <bin dir> <lib dir> [extra library ...]
Every program in <bin dir> (and each extra library, e.g. one loaded at run time) gets the libraries it uses copied
into <lib dir>, all the way down, except the system's (/usr/lib, /System). Programs then load them from
@executable_path/../lib, and the libraries load each other from @loader_path. Then each is signed (ad hoc) again,
since changing a Mach-O breaks its signature. Exits 1 if anything still points outside the package."""
import os, re, shutil, subprocess, sys

def out(*a): return subprocess.run(a, capture_output=True, text=True, check=True).stdout

def deps(path):
    return [l.split(" (compatibility")[0].strip() for l in out("otool", "-L", path).splitlines()[1:] if l.strip()]

def rpaths(path):
    lines, r = out("otool", "-l", path).splitlines(), []
    for i, l in enumerate(lines):
        if l.strip() == "cmd LC_RPATH":
            m = re.search(r"path (\S+)", lines[i + 2])
            if m: r.append(m.group(1))
    return r

def system(d): return d.startswith(("/usr/lib/", "/System/"))

def resolve(dep, origin_real, exe_real):
    """Where a dependency of the file at origin_real really is."""
    if dep.startswith("@loader_path/"): return os.path.realpath(os.path.join(os.path.dirname(origin_real), dep[13:]))
    if dep.startswith("@executable_path/"): return os.path.realpath(os.path.join(os.path.dirname(exe_real), dep[17:]))
    if dep.startswith("@rpath/"):
        for rp in rpaths(origin_real):
            base = rp.replace("@loader_path", os.path.dirname(origin_real)).replace("@executable_path", os.path.dirname(exe_real))
            c = os.path.join(base, dep[7:])
            if os.path.exists(c): return os.path.realpath(c)
        raise SystemExit("relocate: can't find %s for %s" % (dep, origin_real))
    return os.path.realpath(dep)

def main():
    bindir, libdir, extra = sys.argv[1], sys.argv[2], sys.argv[3:]
    os.makedirs(libdir, exist_ok=True)
    progs = [os.path.join(bindir, f) for f in sorted(os.listdir(bindir))]
    src_of = lambda p: os.environ.get("RELOCATE_SRC_" + os.path.basename(p), p)   # where the copy came from
    todo = [(p, src_of(p), src_of(p), "exe") for p in progs]   # (the copy, where its deps resolve from, its program)
    for e in extra:   # a library a program loads at run time: copy it in too
        dst = os.path.join(libdir, os.path.basename(e)); shutil.copy2(os.path.realpath(e), dst); os.chmod(dst, 0o755)
        todo.append((dst, os.path.realpath(e), os.path.realpath(e), "lib"))
    done = set()
    while todo:
        f, origin, exe, kind = todo.pop()
        if f in done: continue
        done.add(f)
        for d in deps(f):
            if system(d): continue
            src = resolve(d, origin, exe)
            name = os.path.basename(d)
            if name == os.path.basename(f) and kind == "lib": continue   # its own id
            dst = os.path.join(libdir, name)
            if not os.path.exists(dst):
                shutil.copy2(src, dst); os.chmod(dst, 0o755)
                todo.append((dst, src, exe, "lib"))
            new = ("@executable_path/../lib/" if kind == "exe" else "@loader_path/") + name
            subprocess.run(["install_name_tool", "-change", d, new, f], check=True, capture_output=True)
        if kind == "lib":
            subprocess.run(["install_name_tool", "-id", "@loader_path/" + os.path.basename(f), f], check=True, capture_output=True)
        for rp in rpaths(f):   # no search paths into the build machine
            if not rp.startswith("@"):
                subprocess.run(["install_name_tool", "-delete_rpath", rp, f], check=True, capture_output=True)
    for f in sorted(done):
        subprocess.run(["codesign", "--force", "--sign", "-", f], check=True, capture_output=True)
    bad = [(f, d) for f in sorted(done) for d in deps(f) if not system(d) and not d.startswith(("@executable_path/../lib/", "@loader_path/"))]
    for f, d in bad: print("relocate: %s still uses %s" % (os.path.basename(f), d), file=sys.stderr)
    print("relocated %d files" % len(done))
    sys.exit(1 if bad else 0)

main()
