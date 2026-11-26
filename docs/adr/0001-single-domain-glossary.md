# One domain glossary for the whole monorepo

The repo is split into `frontend/`, `backend/` and `infra/`, but that is a split by technology, not by domain: Trip, Photo, Member and Invitation mean the same thing everywhere. We keep one root `GLOSSARY.md` instead of a `GLOSSARY-MAP.md` with one glossary per folder (the earlier setup), so the vocabulary can't drift between copies.
