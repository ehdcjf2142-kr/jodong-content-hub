# 조동이형 통합 콘텐츠 허브 (Content Index Site)

Astro 정적 사이트로 유튜브·티스토리·네이버 블로그 링크를 한곳에 모아 보여 줍니다. 메타데이터는 저장소 안의 JSON으로 관리하며, 빌드 시 합쳐집니다.

## 스택

- Astro 6 (정적 출력)
- Tailwind CSS v4 (`@tailwindcss/vite`)
- React islands (테마 토글, 아카이브 검색, `lucide-react`)
- Content Collections (`src/content/videos`, `src/content/blog-links`)
- `@astrojs/sitemap`

## 로컬 실행

```bash
d
```

프로덕션 미리보기:

```bash
npm run build
npm run preview
```

## 콘텐츠 추가 방법

### 유튜브 항목

`src/content/videos/` 아래에 `.json` 파일을 추가합니다. 파일명이 엔트리 ID가 됩니다.

필드:


| 필드             | 타입               | 설명                                                       |
| -------------- | ---------------- | -------------------------------------------------------- |
| `title`        | string           | 영상 제목                                                    |
| `url`          | string (URL)     | YouTube 링크                                               |
| `thumbnailUrl` | string (URL), 선택 | 썸네일 (예: `https://i.ytimg.com/vi/VIDEO_ID/hqdefault.jpg`) |
| `publishedAt`  | ISO 8601 문자열     | 공개 일시                                                    |
| `tags`         | string[]         | 태그                                                       |




### 블로그 링크

`src/content/blog-links/` 아래에 `.json` 파일을 추가합니다.


| 필드            | 타입                      | 설명                |
| ------------- | ----------------------- | ----------------- |
| `title`       | string                  | 글 제목              |
| `url`         | string (URL)            | 티스토리 또는 네이버 글 URL |
| `publishedAt` | ISO 8601 문자열            | 게시 일시             |
| `tags`        | string[]                | 태그                |
| `platform`    | `"tistory"` | `"naver"` | 플랫폼               |
| `summary`     | string, 선택              | 카드에 보여 줄 짧은 요약    |


저장 후 `npm run build`로 타입·스키마가 검증됩니다.

## 자동 동기화 (YouTube API + 블로그 RSS)

외부 소스에서 콘텐츠 JSON을 자동 생성합니다.

```bash
cp .env.example .env
# .env 에 YOUTUBE_API_KEY 입력 (Google Cloud → YouTube Data API v3)

npm run sync:content
npm run build
```


| 소스                                      | 방식                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------- |
| YouTube `@JodongBroOfficial`            | YouTube Data API (`YOUTUBE_API_KEY` 있으면) 또는 **RSS fallback** (키 없어도 동작) |
| Tistory `jodongbro.tistory.com`         | RSS                                                                     |
| Naver `blog.naver.com/gamelifeequation` | RSS                                                                     |


GitHub Actions (`.github/workflows/sync-content.yml`)으로 매일 자동 sync → 커밋 → Vercel 재배포가 가능합니다. 저장소 Secrets에 `YOUTUBE_API_KEY`를 등록하세요.

## 아지트 (짧은 글 · 마일스톤 · 소셜 로그)

| 주소 | 설명 |
| --- | --- |
| `/notes/` | 아지트 짧은 글 (공개 글만 보임. 로그인한 주인에게는 비공개 글도 보임) |
| `/log/` | 유튜브·티스토리·네이버 글을 월별로 모은 소셜 로그 (RSS 자동 수집 데이터 사용) |
| `/admin/` | 주인 전용 관리 화면 (구글 로그인) — 짧은 글 쓰기, 마일스톤 수정 |

짧은 글과 마일스톤은 데이터베이스(Neon)에 저장됩니다. 아래 값이 필요합니다 (`.env.example` 참고, Vercel에도 같은 이름으로 등록).

| 환경변수 | 설명 |
| --- | --- |
| `DATABASE_URL` | Vercel → Storage에서 Neon 연결 시 자동 등록 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud → OAuth 클라이언트 ID (웹 애플리케이션) |
| `ADMIN_EMAIL` | 글쓰기를 허용할 내 구글 이메일 |
| `AUTH_SECRET` | 임의의 긴 문자열 (로그인 출입증 도장용) |

Google OAuth 클라이언트의 "승인된 리디렉션 URI"에 다음을 등록하세요.

- `https://내도메인/api/auth/callback`
- 로컬 테스트용: `http://localhost:4321/api/auth/callback`

필요한 테이블은 처음 접속할 때 자동으로 만들어집니다.

## 검색 인덱스 JSON

빌드 결과물에 `/search-index.json` 이 포함됩니다. 아카이브 페이지의 검색 UI는 이 파일을 `fetch`로 불러와 검색·필터·정렬에 사용합니다.

## 사이트 URL 설정

기본값은 `https://jodong-content-hub.vercel.app` 입니다. 실제 도메인으로 바꾸려면:

1. `[astro.config.mjs](astro.config.mjs)`의 `site` 값 수정, 또는 배포 시 `PUBLIC_SITE_URL` 환경 변수로 덮어쓰기.
2. `[public/robots.txt](public/robots.txt)` 안의 `Sitemap:` 줄을 같은 도메인으로 맞추기.



## GitHub + Vercel 배포



### 1. 저장소 준비

```bash
git init
git add .
git commit -m "feat: content hub with archive search and auto sync"
```

GitHub에 `jodong-content-hub` 저장소를 만든 뒤:

```bash
git remote add origin https://github.com/YOUR_USER/jodong-content-hub.git
git branch -M main
git push -u origin main
```



### 2. Vercel 연결

1. [vercel.com](https://vercel.com) → **Add New Project** → GitHub 저장소 Import
2. Framework: **Astro** (또는 `vercel.json` 자동 인식)
3. Build: `npm run build` (Output Directory는 비워 둡니다. Vercel 어댑터가 자동 처리)
4. Environment Variables (선택):
  - `PUBLIC_SITE_URL` = 배포 후 프로덕션 URL (예: `https://jodong-content-hub.vercel.app`)

> Vercel 빌드는 **커밋된 JSON만** 사용합니다. `YOUTUBE_API_KEY`는 Vercel에 넣지 않아도 됩니다.  
> 자동 갱신은 GitHub Actions (`.github/workflows/sync-content.yml`)에서 sync 후 커밋하는 방식을 권장합니다.



### 3. GitHub Actions Secrets

저장소 **Settings → Secrets → Actions** 에 추가:


| Secret            | 용도                                  |
| ----------------- | ----------------------------------- |
| `YOUTUBE_API_KEY` | 매일 sync 워크플로 (선택, 없으면 RSS fallback) |




### 4. 배포 후 URL 맞추기

프로덕션 URL이 확정되면 다음을 같은 도메인으로 맞춥니다.

1. `[astro.config.mjs](astro.config.mjs)`의 `site` 또는 Vercel `PUBLIC_SITE_URL`
2. `[public/robots.txt](public/robots.txt)`의 `Sitemap:` 줄

다시 커밋·푸시하면 sitemap·canonical URL이 정합됩니다.

### 5. Search Console (선택)

`https://YOUR_DOMAIN/sitemap-index.xml` 제출.

## 브랜딩 커스터마이즈

- 히어로 CTA의 YouTube 링크: `[src/components/home/Hero.astro](src/components/home/Hero.astro)`에서 실제 채널 URL로 변경하세요.
- 폰트·색감: `[src/styles/global.css](src/styles/global.css)`와 Tailwind 유틸 클래스를 조정하면 됩니다.

