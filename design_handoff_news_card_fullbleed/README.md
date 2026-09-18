# Handoff: Instagram News Card — 1a 풀블리드 · 하단 헤드라인

## Overview
1080×1350 (Instagram 4:5) 뉴스 카드 템플릿. 풀블리드 사진 위에 하단 네이비 그라데이션 스크림을 깔고, 소제목 태그 → 헤드라인(수치 강조) → 헤어라인 → 크레딧/도메인 순으로 하단 정렬한다. 상단에는 아무 요소도 없다. 헤드라인·소제목·사진·크레딧은 기사마다 교체되는 데이터다.

## About the Design Files
이 번들의 HTML은 **디자인 레퍼런스**(의도한 룩을 보여주는 프로토타입)이며 그대로 배포할 코드가 아니다. 목표는 대상 코드베이스의 기존 환경(React, 이미지 렌더링 파이프라인, 템플릿 엔진 등)에서 이 디자인을 재현하는 것이다. 환경이 없다면 서버사이드 이미지 렌더(예: Satori/Puppeteer)나 Canvas 기반 템플릿을 권장한다.

## Fidelity
**High-fidelity.** 색상·타이포·간격·크롭이 모두 확정값이다. 픽셀 단위로 재현할 것.

## Screens / Views

### News Card (단일 아트보드)
- **캔버스**: 1080×1350px, `overflow:hidden`, 배경 `#0B1B2B` (이미지 로딩 전 폴백)
- **사진**: absolute, 캔버스 전체 채움. `object-fit:cover; object-position:52% 38%` (컨테이너 항구 사진 기준 — 사진마다 focal point 조정 가능)
- **스크림**: absolute, 캔버스 전체.
  `linear-gradient(to bottom, rgba(11,27,43,0) 34%, rgba(11,27,43,.88) 72%, rgba(11,27,43,.97) 100%)`
  상단 34%는 완전 투명 — 사진을 가리지 않는다.
- **콘텐츠 블록**: absolute, `left:64px; right:64px; bottom:64px` (콘텐츠 폭 952px). 세로 flex, `gap:32px`.
  1. **타이틀 그룹** — 세로 flex, `gap:18px`
     - **소제목 태그** (inline, 내용 폭만큼): 배경 `#C8102E`, 글자 `#FFFFFF`, 28px / 800, `letter-spacing:.02em`, 패딩 `10px 20px`, 라운드 0.
       텍스트: `전년 동기 대비 +120% 성장`
     - **헤드라인** `h1`: 88px / 800, `line-height:1.14`, `letter-spacing:-.025em`, `text-wrap:pretty`, 3줄 고정 줄바꿈.
       1행 `8월 스위스 무역 흑자,` — `#FFFFFF`
       2–3행 `37억 9천만` / `스위스 프랑 기록` — `#FFC72C` (수치 강조 span)
  2. **푸터 그룹** — 세로 flex, `gap:18px`
     - 헤어라인: `height:2px; background:rgba(255,255,255,.3)`
     - 메타 행: 가로 flex, `space-between`, 24px / 600, `rgba(255,255,255,.72)`
       좌 `사진 연합뉴스` · 우 `wowtv.co.kr` (`letter-spacing:.06em`)

## Interactions & Behavior
정적 이미지 카드. 인터랙션·애니메이션 없음.
- 헤드라인 길이 규칙: 88px 기준 한 줄 최대 약 11자(한글). 3줄 초과 시 80px → 72px로 단계 축소.
- 소제목이 없으면 태그를 렌더하지 않고 그룹 gap만 유지.
- 수치 강조 span은 선택 사항 — 없으면 전체 헤드라인 `#FFFFFF`.

## State Management
템플릿 입력값:
- `image` (URL), `imageFocal` (object-position, 기본 `52% 38%`)
- `kicker` (소제목, optional)
- `headlineLines` (문자열 배열, 줄 단위) + `highlightFrom` (골드 시작 줄 index, optional)
- `credit` (기본 `사진 연합뉴스`), `domain` (기본 `wowtv.co.kr`)

## Design Tokens
**Colors**
- Navy (배경/스크림) `#0B1B2B`
- Red (태그) `#C8102E`
- Gold (수치 강조) `#FFC72C`
- White `#FFFFFF`; 메타 `rgba(255,255,255,.72)`; 헤어라인 `rgba(255,255,255,.3)`

**Typography** — Pretendard (CDN: jsdelivr `pretendard@v1.3.9`), 폴백 Apple SD Gothic Neo / Noto Sans KR
- Headline 88px · 800 · lh 1.14 · ls -0.025em
- Kicker 28px · 800 · ls 0.02em
- Meta 24px · 600 (도메인 ls 0.06em)

**Spacing**: 외곽 여백 64px · 그룹 간 32px · 그룹 내 18px · 태그 패딩 10/20
**Radius**: 0 (태그) · **Shadow**: 없음

## Assets
- `PYH2026090110410005100.jpg` — 부산항 컨테이너 터미널 (연합뉴스). 샘플용이며 실제 서비스에서는 기사 사진으로 교체.
- Pretendard 웹폰트 (jsdelivr CDN)

## Files
- `News Card 1a.dc.html` — 카드 단일 아트보드 (브라우저에서 바로 열림)
- `PYH2026090110410005100.jpg` — 샘플 사진
