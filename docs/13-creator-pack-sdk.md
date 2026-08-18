# EditWeave Creator Pack SDK 1.0

## 목적

Creator Pack은 코드를 실행하지 않고 EditWeave의 제작 자산을 묶어 배포하는 선언형 확장 형식이다. Pack은 네트워크·파일시스템·임의 코드 실행 권한을 가질 수 없으며, 설치 전에 호환성·크기·개수·SHA-256 무결성과 선택적 Ed25519 제작자 서명을 검사한다.

- Pack 스키마: `editweave-creator-pack-v2`
- 현재 Pack API: `1.0.0`
- JSON Schema: [`../schemas/editweave-creator-pack-v2.schema.json`](../schemas/editweave-creator-pack-v2.schema.json)
- Catalog Schema: [`../schemas/editweave-creator-catalog-v1.schema.json`](../schemas/editweave-creator-catalog-v1.schema.json)
- 최대 직렬화 크기: 2MB
- 지원 자산: 모션, 속도, 오디오 팀, 타이틀 스타일, 출력, 전환 프리셋

## 제작과 배포 흐름

1. EditWeave에서 사용할 템플릿과 프리셋을 만든다.
2. `createCreatorPack()`으로 현재 사용자 자산을 Pack에 수집한다.
3. 필요 없는 범주의 배열을 비우고 이름·버전·호환 범위를 지정한다.
4. `serializeCreatorPack()`으로 정규화된 내용의 SHA-256을 생성한다.
5. 배포자 신원을 표시하려면 `signCreatorPack()`으로 Ed25519 서명을 추가한다.
6. 수신자는 `parseCreatorPack()` 검증을 통과한 객체만 설치 후보로 사용한다.
7. 서명 Pack은 `setCreatorPackPublisherTrust()`로 공개키를 명시적으로 신뢰한 뒤 `installCreatorPack()`에 전달한다.

```ts
import {
  createCreatorPack,
  installCreatorPack,
  parseCreatorPack,
  setCreatorPackPublisherTrust,
  serializeCreatorPack,
  signCreatorPack,
} from '../src/platform/creatorPacks'

const draft = createCreatorPack('Studio Titles', 'Example Studio')
draft.version = '1.1.0'
draft.compatibility = { minimumApiVersion: '1.0.0', maximumApiVersion: '1.0.0' }
draft.contents.motionTemplates = []

// 서명 없는 Pack도 SHA-256 무결성 검사를 받는다.
const json = await serializeCreatorPack(draft)
const verified = await parseCreatorPack(json)
installCreatorPack(verified)

// 선택적 제작자 서명. 키 보관·배포자 신뢰 정책은 배포 채널의 책임이다.
const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
const signed = await signCreatorPack(draft, keys.privateKey, keys.publicKey, 'example-studio-2026')
const verifiedSigned = await parseCreatorPack(JSON.stringify(signed))
setCreatorPackPublisherTrust(verifiedSigned, 'trusted')
installCreatorPack(verifiedSigned)
```

## 보안·호환성 계약

| 계약 | 설치 동작 |
| --- | --- |
| `security`의 세 권한이 모두 `false` | 설치 가능 |
| 코드·네트워크·파일 권한 중 하나라도 요청 | 설치 차단 |
| 현재 API가 `minimumApiVersion`~`maximumApiVersion` 밖 | 설치 차단 |
| SHA-256 누락·불일치 | 설치 차단 |
| Ed25519 서명이 있되 유효하지 않음 | 설치 차단 |
| 유효한 서명이 있으나 공개키를 아직 신뢰하지 않음 | 사용자 신뢰 결정 전 설치 차단 |
| 같은 `keyId`에 다른 공개키가 들어옴 | 키 바꿔치기로 판정하고 설치 차단 |
| 차단한 공개키로 서명됨 | 설치 차단 |
| 설치된 Pack 업데이트의 공개키 지문이 달라짐 | 키 ID와 무관하게 업데이트 차단 |
| 설치 버전보다 낮은 Pack | 기본 다운그레이드 차단 |
| 서명이 없음 | 무결성 검증 후 `unsigned`로 명시하고 사용자 검토 설치 |
| v1 Pack | 권한을 다시 검사하고 `legacy-unsigned`로 제한적 마이그레이션 |
| 동일 콘텐츠 재설치 | 콘텐츠 서명으로 중복 방지 |
| 설치 후 사용자가 수정한 자산 제거 | 수정본 보존, 변경되지 않은 소유 자산만 제거 |

Ed25519 서명 검증은 “이 파일이 포함된 공개키로 서명됐다”는 사실을 확인한다. EditWeave은 사용자가 신뢰·차단한 공개키와 SHA-256 키 지문을 로컬에 저장하고 설치된 Pack에 지문을 고정한다. 최초 공개키가 실제 제작자의 것인지 자동으로 보장하는 마켓플레이스 인증서·외부 신뢰 체인은 별도 상용 인프라로 남아 있다.

## 타임라인 교환 계약

Creator Ecosystem 게이트는 OTIO, Premiere Pro XML, FCPXML, CMX 3600 EDL 내보내기→가져오기 왕복을 자동 검사한다.

| 형식 | 권장 용도 | 보존 수준 |
| --- | --- | --- |
| OTIO | EditWeave 및 메타데이터 친화 파이프라인 | 마커·트랙 설정·변형·전환 등 EditWeave 확장 메타데이터 보존 |
| Premiere Pro XML | Premiere 중심 전달 | 기본 컷·미디어·변형·전환·마커 중심 |
| FCPXML | Final Cut Pro 전달 | 기본 컷·미디어·변형·전환 중심 |
| CMX 3600 EDL | 가장 넓은 레거시 호환 | 컷·릴·소스/레코드 타임코드 중심, 구조적 손실 예상 |

교환 파일은 프로젝트 자체의 완전한 백업 형식이 아니다. 고급 효과, 생성 자산, 일부 자동화는 원본 EditWeave 프로젝트와 함께 보관해야 한다.

## 카탈로그·업데이트 배포 계약

운영 카탈로그는 `editweave-creator-catalog-v1` 형식이며 최대 1MB, Pack·회수 항목 각각 최대 1,000개다. 앱은 카탈로그 서명을 빌드에 고정된 Ed25519 공개키와 `keyId`로 확인한다.

```text
VITE_EDITWEAVE_CREATOR_CATALOG_URL=https://packs.example.com/catalog.json
VITE_EDITWEAVE_CREATOR_CATALOG_PUBLIC_KEY=<Ed25519 raw public key, Base64>
VITE_EDITWEAVE_CREATOR_CATALOG_KEY_ID=editweave-pack-catalog-2026
```

카탈로그 다운로드와 Pack 다운로드는 자격 증명·fragment 없는 HTTPS만 허용하며 cookies, referrer, redirect를 보내지 않는다. 카탈로그에서 Pack을 선택하면 다음 조건을 모두 통과한 경우에만 설치 후보 화면으로 이동한다.

1. 다운로드 파일이 2MB 이하의 올바른 UTF-8이다.
2. 파일 바이트 SHA-256이 카탈로그 `artifactSha256`과 같다.
3. Creator Pack 자체 SHA-256과 Ed25519 제작자 서명이 유효하다.
4. Pack ID·버전·제작자명이 카탈로그 항목과 같다.
5. 제작자 공개키 SHA-256 지문이 `publisherKeyFingerprint`와 같다.
6. 설치된 버전보다 낮거나 설치 기록의 키 지문과 다르지 않다.

사용자가 가져온 로컬 카탈로그는 `local-untrusted`로 표시한다. 탐색에는 사용할 수 있지만 회수 명령의 권위는 인정하지 않으며, 카탈로그 경유 Pack은 운영/로컬 여부와 관계없이 제작자 서명이 필수다.

서명된 운영 카탈로그의 회수 항목은 Pack ID와 버전, artifact SHA-256 또는 제작자 키 지문으로 대상을 좁힌다. 설치된 Pack과 일치하면 제거 경고를 표시하며 회수된 다운로드 항목은 비활성화한다.

### 제작자·운영자 CLI

앱에서 내보낸 Pack은 제작자가 오프라인에 보관한 장기 Ed25519 키로 서명한다.

```powershell
node release/sign-creator-pack.mjs .\My-Pack.editweave-pack.json X:\secure\publisher-private.pem studio-main .\my-pack-1.0.0.editweave-pack.json
```

운영자는 서명 Pack artifact 디렉터리에서 카탈로그를 생성하고, 별도의 카탈로그 개인키로 오프라인 서명한다.

```powershell
node release/create-creator-pack-catalog.mjs release/creator-pack-channel/packs https://packs.example.com "EditWeave Creator Catalog" release/creator-pack-channel/revocations.json release/creator-pack-channel/catalog.unsigned.json
node release/sign-creator-pack-catalog.mjs release/creator-pack-channel/catalog.unsigned.json X:\secure\catalog-private.pem release/creator-pack-channel/catalog.json
```

검증형 서버와 Docker/Caddy 배포 절차는 [`../services/creator-pack-server/README.md`](../services/creator-pack-server/README.md)를 따른다. 서버에는 두 개인키 중 어느 것도 두지 않고 카탈로그 공개키와 읽기 전용 channel snapshot만 제공한다.

## 검증

```powershell
pnpm check:creator-ecosystem
```

이 명령은 Pack 무결성·서명·권한·API 호환, 제작자 키 신뢰·차단·바꿔치기 탐지, 카탈로그 서명·검색·HTTPS 다운로드·artifact 신원·회수, 업데이트·다운그레이드 판정, 설치/안전 제거와 네 가지 교환 형식 왕복을 검사한 뒤 production build와 Rust/Tauri 컴파일을 실행한다.
