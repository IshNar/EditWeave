# Signed update channel input

배포 서버가 읽는 불변 입력 폴더다. 개인 키는 이 폴더와 서버에 두지 않는다.

```text
manifests/
  stable/
    windows-x86_64.json
    windows-aarch64.json
    macos-x86_64.json
    macos-aarch64.json
    macos-universal.json
  beta/
    <같은 platform 이름>.json
artifacts/
  EditWeave_1.0.0_windows_x86_64-setup.exe
  EditWeave_1.0.0_macos_aarch64.dmg
```

각 매니페스트의 `channel`과 `platform`은 상위 폴더·파일명과 같아야 한다. `downloadUrl`은 운영 origin의 `/editweave/artifacts/<파일명>`이어야 하며 query/hash를 포함하지 않는다. immutable URL 재사용을 막기 위해 파일명에는 전체 릴리스 version을 포함한다. 설치 파일을 `artifacts`에 둔 뒤 SHA-256을 입력하고 저장소 밖의 Ed25519 개인 키로 `release/sign-update-manifest.mjs`를 실행한다.

업데이트 서버는 시작 또는 SIGHUP reload 때 모든 매니페스트의 고정 canonical payload와 Ed25519 서명, 실제 설치 파일 SHA-256·크기·확장자를 확인한다. 하나라도 실패하면 새 catalog를 제공하지 않는다. 매니페스트와 설치 파일은 같은 릴리스 단위로 교체하고 서버에 개인 키를 복사하지 않는다.
