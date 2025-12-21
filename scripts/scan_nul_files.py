#!/usr/bin/env python3
import os
import argparse

TEXT_EXTENSIONS = {
    ".md", ".txt", ".markdown", ".rst",
    ".json", ".yaml", ".yml", ".csv"
}

def is_text_candidate(path):
    _, ext = os.path.splitext(path.lower())
    return ext in TEXT_EXTENSIONS

def scan_file(path, nul_threshold=0.01):
    """
    Returns:
        None            -> clean
        dict            -> suspect info
    """
    try:
        with open(path, "rb") as f:
            data = f.read()
    except Exception as e:
        return {"error": str(e)}

    size = len(data)
    if size == 0:
        return None

    nul_count = data.count(b"\x00")
    if nul_count == 0:
        return None

    ratio = nul_count / size

    return {
        "size": size,
        "nul_count": nul_count,
        "nul_ratio": ratio,
    }

def main(root, nul_threshold):
    print(f"Scanning: {root}")
    print(f"NUL ratio threshold: {nul_threshold:.2%}")
    print("-" * 72)

    hits = []

    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            path = os.path.join(dirpath, name)

            if not is_text_candidate(path):
                continue

            result = scan_file(path, nul_threshold)
            if result:
                hits.append((path, result))

    if not hits:
        print("✅ No suspicious files found.")
        return

    print(f"⚠️  Found {len(hits)} suspicious file(s):\n")

    for path, info in hits:
        if "error" in info:
            print(f"[ERROR] {path}: {info['error']}")
            continue

        print(f"[NUL] {path}")
        print(f"      Size      : {info['size']} bytes")
        print(f"      NUL bytes : {info['nul_count']}")
        print(f"      NUL ratio : {info['nul_ratio']:.2%}")
        print()

    print("⚠️  Recommendation:")
    print("   - Open these files with a hex editor or Obsidian")
    print("   - Compare with Dropbox Web / mobile version")
    print("   - Recover from the last known-good content")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Scan directory for text files containing NUL bytes (0x00)"
    )
    parser.add_argument("path", help="Root directory to scan (e.g. Obsidian vault)")
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.01,
        help="NUL ratio threshold (default: 0.01 = 1%)"
    )

    args = parser.parse_args()
    main(args.path, args.threshold)
