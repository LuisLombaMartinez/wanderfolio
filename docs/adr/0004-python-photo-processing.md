# Photo processing in Python, the rest of the backend in Go

The API is Go, but the photo-processing steps (read metadata, make web versions) run as Python Lambdas inside the Step Functions workflow. Python's Pillow, with `pillow-heif`, decodes JPEG, PNG, WebP and HEIF and handles EXIF rotation out of the box. Go's standard image libraries can't read HEIF without native libraries. The project is deliberately polyglot: it is also a test of the software factory working across languages.
