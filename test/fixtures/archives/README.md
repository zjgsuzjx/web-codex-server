The tiny stored RAR5 sample embedded in `test/helpers/archive-fixtures.js` and
`encrypted.rar.uu` come from the [libarchive test suite](https://github.com/libarchive/libarchive/tree/master/libarchive/test):

- `test_read_format_rar5_stored.rar.uu`
- `test_read_format_rar5_encrypted.rar.uu`

They contain synthetic test data only. The upstream project is distributed under
the [BSD license](https://github.com/libarchive/libarchive/blob/master/COPYING).
Other archive fixtures are generated locally from synthetic TAR entries during
tests; no real account or project data is used.
