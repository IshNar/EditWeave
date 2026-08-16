# Creator Pack channel

운영 배포 직전의 불변 Pack artifact와 서명 catalog를 두는 디렉터리다.

```text
release/creator-pack-channel/
├─ catalog.json              # 운영 Ed25519 서명 완료본
├─ catalog.unsigned.json     # 서명 전 검토본, 운영 서버에서는 사용하지 않음
├─ revocations.json          # 선택적 회수 입력 배열
└─ packs/
   └─ <slug>-<version>.cutline-pack.json
```

`packs/`의 파일은 catalog 생성 후 제자리에서 수정하지 않는다. 새 버전 파일을 추가하고 catalog를 다시 생성·검토·오프라인 서명한 뒤 완성된 디렉터리 스냅샷을 원자적으로 교체한다. 운영 서버에는 catalog 공개키와 이 디렉터리의 읽기 전용 mount만 제공한다.
