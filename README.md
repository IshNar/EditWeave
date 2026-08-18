# EditWeave

쇼츠와 일반 영상을 한 프로젝트에서 편집하는 크리에이터 중심 데스크톱 영상 편집기입니다.

현재 소스는 단계별 프로토타입이나 V1/V2 범위가 아니라 **전체 출시 제품 기준**으로 개발합니다. 실제 미디어 가져오기부터 정밀 타임라인·중첩·색상 노드·오디오 버스/ADR·로컬 AI 초벌·본편/쇼츠 파생·Delivery Guard·복구 가능한 렌더·검토까지 하나의 완성된 작업 흐름으로 연결합니다. 패키지의 기술 버전 번호는 호환성과 업데이트를 위한 식별자일 뿐 개발 범위를 제한하지 않습니다.

## 실행

Windows에서 최신 소스 개발 버전을 실행:

```powershell
.\run.bat
```

`run.bat`은 pnpm과 `node_modules`가 있으면 최신 소스를 `desktop:dev`로 실행합니다. 2026-08-15 Windows x64 배포 EXE를 실행하려면 `run.bat release`를 사용합니다. MSI/NSIS도 같은 소스로 재생성됐고 NSIS의 격리 경로 무인 설치·60분 렌더·강제 종료 복구·제거를 통과했습니다. 코드 서명, MSI 관리자 설치, 실제 업데이트와 일반 사용자 환경 검증은 아직 출시 게이트로 남아 있습니다.

macOS에서는 실행 권한을 준 뒤 `run.command`를 사용할 수 있습니다.

```bash
chmod +x run.command
./run.command
```

개발 서버 실행:

```powershell
pnpm install
pnpm dev
```

전체 검증 명령(사용자 실행):

```powershell
pnpm check
```

Tauri 데스크톱 실행과 설치 패키지 생성:

```powershell
pnpm desktop:dev
pnpm desktop:build
```

## 최신 Tauri 장시간 실측

2026-08-15 실제 Tauri 개발 실행본의 30분 H.264/AAC와 NSIS 격리 설치본의 60분 렌더·강제 종료 복구를 통과했습니다. 완성 파일은 108,000프레임·3600초·304.22MB, 전체 디코드 오류 0, SSIM 0.976030, 8개 PCM 창 지연 0샘플입니다. WebView가 직접 지원하지 않는 AAC 5.1과 HEVC Main10은 번들 코덱 엔진 fallback으로 연결했습니다. Chromium `format=null` Main10 원본의 중립 60초 SSIM은 PQ 0.999636·HLG 0.999711입니다. WGSL 예약어로 HDR 효과가 검정이던 결함도 실출력 신호 QC로 발견·수정해 최종 설치본의 PQ +0.5 노출 900프레임과 중립 PQ/HLG 각 900프레임을 통과했습니다. 리브랜딩 전 실출력 검증 NSIS는 74,870,003바이트, SHA-256 `014CD37E7D9CAD6E41D1B61EEBBD22277644391B31516259DDCB06C8B575D443`입니다. 2026-08-18 EditWeave 패키지는 `editweave.exe`, MSI 91,402,240바이트, NSIS 74,718,655바이트로 재빌드했고 NSIS SHA-256은 `3703745EAC25F75EFD24E2F73E10D683ADEE9B95FF023CBD82F2BE6004A4438B`입니다. 상용화 통합 게이트는 실제 PQ/HLG·VFR·전문 코덱·Authenticode·macOS 공증·HDR 계측·사용자/운영 증거 10개를 모두 요구하도록 구현했습니다. 설치본은 아직 Authenticode `NotSigned`이고 적격 실물 증거가 없어 외부 배포 완료가 아니라 로컬 설치본 실출력 검증 완료로 판정합니다.

현재 전체 회귀는 Vitest 36개 파일 192개와 Creator Pack 운영 경로 Node 테스트 3개가 통과합니다.

## 문서 읽는 순서

1. [제품 개요](docs/01-product-brief.md)
2. [초기 개발 기록 (보관)](docs/02-prototype-plan.md)
3. [최종 제품 계획](docs/03-final-product-plan.md)
4. [기술 아키텍처](docs/04-architecture.md)
5. [GUI 가이드](docs/05-gui-guidelines.md)
6. [릴리스와 남은 로드맵](docs/06-release-and-roadmap.md)
7. [전체 출시 개발 범위 기록](docs/07-v1-development-candidate.md)
8. [실무용 완성품 전환 계획](docs/08-production-completion-plan.md)
9. [Top 3 벤치마크와 차별화](docs/09-top3-benchmark-and-differentiation.md)
10. [구현 근거 매트릭스](docs/10-implementation-evidence-matrix.md)
11. [전체 출시 대비 현황 보고서](docs/11-full-release-readiness.md)
12. [Top-tier 완성 실행 계획](docs/12-top-tier-execution-plan.md)
13. [Creator Pack SDK 1.0](docs/13-creator-pack-sdk.md)
14. [2026-08-14 경쟁 비교표](docs/20260814경쟁%20비교표.md)
15. [문제 해결 기록](troubleshooting.md)
16. [개발 이력](history.md)
17. [충돌 수집 서버 운영](services/crash-collector/README.md)
18. [서명 업데이트 서버 운영](services/update-server/README.md)
19. [Creator Pack 서버 운영](services/creator-pack-server/README.md)

## 현재 개발 기준

Windows x64 0.1.0 EXE/MSI/NSIS는 2026-08-15 최신 소스로 재빌드됐습니다. 2026-08-15 기준 E1 출시 신뢰성부터 E9 Creator Ecosystem까지 자동화 Epic 9/9가 통과했습니다. E4는 대본·하이라이트·음성 에너지·얼굴 안정성·장면 시작과 삭제 후보 감점을 결합하며 추천 근거를 표시합니다. E5는 본편 변경을 영상·오디오·대본/자막·AI 제안·마커·설정으로 분리해 단일 또는 일괄 반영하고 파생 쇼츠의 직접 보정을 보존합니다. 파생 쇼츠 100개의 영향 집계·일괄 동기화·stale 0개 회귀와 기존 복구형 일괄 출력 연결을 완료했습니다. E6는 주요 AI 명령의 입력 범주·처리 위치·프로세서·이유·승인·변경 결과·복구 방법을 최대 250건까지 프로젝트에 저장하고 무승인 외부 AI 활동을 차단합니다. E7은 sRGB·Rec.709·Rec.2020·PQ·HLG·10-bit limited-range의 6색 기준 패치와 HDR10 `mdcv`·`clli` 메타데이터 직렬화를 자동 검증합니다. E8은 Web·EBU R128 방송·팟캐스트 프로파일, 완성 파일 LUFS·dBTP 재측정, 5.1·Stem·버스 Solo·ADR 승인 컴프 적합성 검사를 제공합니다. E9는 Creator Pack v2, 제작자 키 신뢰·차단, 서명 운영 카탈로그, HTTPS artifact 검증, 검색·업데이트·회수, 제작자/카탈로그 오프라인 서명 CLI와 검증형 배포 서버를 제공합니다. 10·30·60분 합성 프로젝트는 전체 저장·재열기, 링크 A/V 매핑, 프레임 경계와 60분 리플 편집·원자적 Undo를 전용 게이트로 검증합니다. 미리보기·출력 계약은 23.976·29.97·30·59.94fps에서 컷·전환·속도·중첩·자막·오디오 자동화의 활성 레이어와 소스 프레임·샘플 매핑을 비교합니다. 실제 FFV1/PCM 기준과 H.264/AAC 납품 파일을 RGB24·f32 PCM으로 재디코딩해 SSIM·PSNR·픽셀 오차·PCM 상관·샘플 지연을 측정하는 QC 엔진도 자동 검증합니다. EditWeave 자체 렌더 E2E는 H.264 7프로파일과 HEVC SDR을 합쳐 342프레임을 실제 생성하고 330프레임을 RGB24로 비교했습니다. HEVC SDR은 SSIM 0.999964·PSNR 37.19dB, 전체 실행 가능 영상 프로필은 PCM 상관 0.99973 이상·지연 0샘플로 8/8 통과했습니다. 24-bit 48kHz 5.1 WAV Full Mix도 실제 출력·재디코딩해 6채널과 센터 전용 대사 RMS 0.04655, 나머지 채널 0, PCM 상관 0.99983, 지연 0샘플을 확인했습니다. 30초 900프레임에 이어 10분 H.264/AAC 18,000프레임을 348.68초에 출력했고, 59.57MB 파일·JS 힙 +119.72MB·대표 16프레임 SSIM 0.999928·PSNR 30.10dB·시작/끝 PCM 지연 0ms를 통과했습니다. 긴 오디오 비교는 첫·끝 2초만 고정 크기로 보관해 QC 메모리를 제한합니다. 실제 데스크톱 납품은 영상·WAV·프록시·구간 결합을 8MiB 상한으로 파일에 스트리밍하며, 단일 영상은 30초 체크포인트·재개·무손실 결합을 사용합니다. 임의 위치·기록 바이트 수 검증과 초기화 실패·부분 쓰기·취소 시 불완전 파일 삭제를 자동 계약으로 고정했습니다. WebView가 HEVC Main10 또는 AAC 5.1 직접 인코딩을 지원하지 않아도 WebGPU I420P10 원시 체크포인트와 연속 5.1 WAV를 번들 FFmpeg에 전달해 저정밀도·스테레오 자동 대체 없이 완성합니다. 실제 Tauri PQ·HLG와 AAC 5.1 각 60초 파일이 올바른 스트림 구성과 전 구간 디코드 오류 0을 통과했습니다. 전체 Vitest는 35개 파일 190개 테스트, Creator Pack 운영 경로 Node 회귀 3개가 통과했습니다. TypeScript, Vite production build, Rust `cargo check`도 통과했고 새 EXE의 8초 기본 기동 스모크 테스트도 통과했습니다. 현재 E1~E9 자동 회귀와 Pack 배포 코드 경로, 합성 장시간 정합성, 타임라인 수준 미리보기·출력 동등성, 디코딩 artifact QC 엔진, H.264 7프로파일·HEVC SDR·PQ/HLG Main10·5.1 WAV·AAC 5.1·10분 실제 렌더 E2E, Tauri 스트리밍 파일 자동 계약과 30/60분 설치본 실물 E2E는 완료됐습니다. 실제 장비 원본의 재생·탐색·GPU·HDR 휘도·오디오 클록 드리프트, 외부 품질 도구·사용자 과업과 Creator Pack 운영 도메인·제작자 심사·결제·신고 운영은 별도 상용 게이트로 남아 있습니다.
