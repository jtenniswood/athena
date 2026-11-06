# APK scanner warning investigation

The November 6, 2026 latest-main APK (source `36e561a`, version code 2681) was
compared locally with the November 5 APK before the Android Gradle plugin update
(source `38cefcf`, version code 2668). The user reported a scanner warning after
updating; its exact wording and scanner category were unavailable.

The downloaded APK hashes matched their published metadata. Both builds use the
pinned signing certificate and the same merged permissions, target SDK 36,
cleartext-disabled setting and backup-disabled setting. Their 84,540 compiled
method/opcode records match. There are no added archive entries. The changed
entries are build/compiler metadata, the baseline profile, the primary DEX and
the manifest. DEX string changes identify the new build/revision and D8 9.5.29
instead of 9.5.28. The secondary DEX is byte-for-byte identical.

The only intervening Android build configuration change was Android Gradle
plugin 9.5.0 → 9.5.1. The 0.2.3 rebuild restores 9.5.0 as a controlled packaging
rollback. This does not prove the compiler caused the warning or guarantee that
a vendor will clear it: a new APK hash can also have a different reputation.
No signing key is rotated, no permissions are hidden, and no scan protection is
disabled.

Release generation now checks the final merged APK's permissions, rejects
unreviewed additions or older target SDKs, and publishes `apk-security.json`
with the APK hash, certificate, target SDK and permission inventory. The existing
signature, package, Firebase and checksum checks remain mandatory. This report
is build evidence, not a malware-scan verdict.

If a rebuilt APK is still flagged, retain the exact warning, scanner name and
app build number. A scan recommendation for an unfamiliar app differs from a
harmful-app classification. Follow [Google's developer guidance](https://developers.google.com/android/play-protect/warning-dev-guidance)
for that specific message; a confirmed erroneous classification may require a
vendor appeal. Do not bypass or disable Play Protect to validate the fix.
