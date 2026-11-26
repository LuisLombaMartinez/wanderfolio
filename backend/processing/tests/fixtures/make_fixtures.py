"""Generates tests/fixtures/*. Run once: python make_fixtures.py <outdir>. Files are committed."""

import io
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw
from pillow_heif import register_heif_opener

register_heif_opener()

_EXIF_TAGS: dict[str, int] = {"orientation": 0x0112, "dto": 0x9003, "offset": 0x9011}


def pic(size: tuple[int, int] = (240, 160), mode: str = "RGB") -> Image.Image:
    img = Image.new(mode, size, (30, 90, 200))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, size[0] // 2, size[1] // 2), fill=(230, 40, 40))  # red top-left marker
    return img


def exif(**tags: object) -> Image.Exif:
    e = Image.Exif()
    sub: dict[int, object] = {}
    for k, v in tags.items():
        if k == "orientation":
            e[_EXIF_TAGS[k]] = v
        elif k in ("dto", "offset"):
            sub[_EXIF_TAGS[k]] = v
        elif k == "gps":
            e[0x8825] = {1: "N", 2: (38.0, 43.0, 0.0), 3: "W", 4: (9.0, 8.0, 0.0)}
    if sub:
        e[0x8769] = sub
    return e


def with_irot(heic: bytes, quarter_turns: int) -> bytes:
    """Add an `irot` (rotate counter-clockwise by 90 x quarter_turns degrees) property to the
    primary item of a single-image HEIC, the way phones mark a portrait shot. pillow-heif cannot
    write one itself. Assumes the layout pillow-heif writes: iloc v0 with one item and a 4-byte
    base offset, ipma v0 with one entry, `meta` before `mdat`."""
    irot = struct.pack(">I4sB", 9, b"irot", quarter_turns)
    data = bytearray(heic)

    def find(kind: bytes, start: int = 0) -> int:
        return data.index(kind, start) - 4  # offset of the box (size field)

    meta, iprp = find(b"meta"), find(b"iprp")
    ipco, ipma, iloc = find(b"ipco", iprp), find(b"ipma", iprp), find(b"iloc")
    ipco_end = ipco + struct.unpack_from(">I", data, ipco)[0]
    count, pos = 0, ipco + 8
    while pos < ipco_end:
        count += 1
        pos += struct.unpack_from(">I", data, pos)[0]
    # ipma v0: fullbox(4) entry_count(4) item_id(2) assoc_count(1) assocs
    assoc_count_at = ipma + 8 + 4 + 4 + 2
    data[assoc_count_at] += 1
    assoc_end = ipma + struct.unpack_from(">I", data, ipma)[0]
    data[assoc_end:assoc_end] = bytes([0x80 | (count + 1)])  # essential + new property index
    data[ipco_end:ipco_end] = irot
    for box, grow in ((ipco, 9), (ipma + 9, 1), (iprp, 10), (meta, 10)):  # ipma moved by 9
        struct.pack_into(">I", data, box, struct.unpack_from(">I", data, box)[0] + grow)
    # iloc v0: fullbox(4) sizes(2) item_count(2) item_id(2) data_ref(2) base_offset(4)
    base_at = iloc + 8 + 4 + 2 + 2 + 2 + 2
    base = struct.unpack_from(">I", data, base_at)[0]
    struct.pack_into(">I", data, base_at, base + 10)
    return bytes(data)


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    pic().save(out / "dated.jpg", exif=exif(dto="2024:07:14 18:30:05", offset="+02:00"), quality=80)
    pic().save(out / "dated_no_offset.jpg", exif=exif(dto="2024:07:14 18:30:05"), quality=80)
    pic().save(out / "garbage_date.jpg", exif=exif(dto="not a date"), quality=80)
    pic().save(out / "no_exif.jpg", quality=80)
    pic().save(out / "rotated.jpg", exif=exif(orientation=6), quality=80)
    pic().save(out / "gps.jpg", exif=exif(gps=True, dto="2023:01:02 03:04:05"), quality=80)
    pic().save(out / "sample.png")
    pic().save(out / "sample.webp", quality=80)
    pic().save(
        out / "sample.heic",
        format="HEIF",
        quality=70,
        exif=exif(dto="2022:12:25 10:00:00", offset="-05:00", gps=True),
    )
    (out / "corrupt.heic").write_bytes((out / "sample.heic").read_bytes()[:300])
    (out / "corrupt.jpg").write_bytes(b"\xff\xd8\xff\xe0 this is not really a jpeg")

    buf = io.BytesIO()
    pic((160, 240)).save(buf, format="HEIF", quality=70)
    # Stored 160x240 (portrait pixels) with irot 1 (turn 90 degrees counter-clockwise): the
    # displayed picture is 240x160 landscape, the red marker moves from top-left to bottom-left.
    (out / "rotated.heic").write_bytes(with_irot(buf.getvalue(), 1))


if __name__ == "__main__":
    main()
