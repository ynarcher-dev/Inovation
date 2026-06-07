# AWS S3 설정

브라우저에서 presigned URL로 S3에 **직접 PUT 업로드**하려면, S3 버킷에 CORS 규칙이 있어야 합니다.
이 규칙이 없으면 업로드 시 다음과 같은 에러가 발생합니다.

```
Access to fetch at 'https://yna-innovation.s3...amazonaws.com/...' from origin
'http://127.0.0.1:5500' has been blocked by CORS policy: Response to preflight
request doesn't pass access control check: No 'Access-Control-Allow-Origin'
header is present on the requested resource.
```

> 참고: Supabase Edge Function(`s3-presigned-url`)의 CORS는 코드에서 이미 처리됩니다.
> 위 에러는 **S3 버킷 자체**의 CORS 설정이 없어서 발생하므로, AWS에서 한 번만 적용하면 됩니다.

## 적용 방법

### 1) AWS CLI

[s3-cors.json](./s3-cors.json)의 `AllowedOrigins`에 실제 배포 도메인을 넣은 뒤 실행합니다.

```bash
aws s3api put-bucket-cors \
  --bucket yna-innovation \
  --cors-configuration file://aws/s3-cors.json \
  --region ap-northeast-2
```

적용 확인:

```bash
aws s3api get-bucket-cors --bucket yna-innovation --region ap-northeast-2
```

### 2) AWS 콘솔

S3 → `yna-innovation` 버킷 → **Permissions** 탭 → **Cross-origin resource sharing (CORS)**
→ Edit → [s3-cors.json](./s3-cors.json) 내용 붙여넣기 → Save.

## 주의

- `AllowedOrigins`에는 앱이 실제로 열리는 origin(스킴+호스트+포트)을 정확히 적어야 합니다.
  로컬 Live Server는 보통 `http://127.0.0.1:5500`입니다.
- 운영 배포 시 `https://your-production-domain.com`을 실제 도메인으로 교체하세요.
- 와일드카드 `*`도 가능하지만, presigned URL이 권한을 제어하므로 origin은 명시하는 것을 권장합니다.
