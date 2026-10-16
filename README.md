# 착공계 원스톱 — 판매용 서버

착공계 서류 작성 프로그램을 **회원가입 → 계좌이체 신청 → 입금 확인 → 라이선스 발급 → IP 등록** 흐름으로 판매하기 위한 웹 서비스입니다.

## 주요 기능

| 구분 | 내용 |
|---|---|
| 회원 | 이메일 회원가입·로그인, 비밀번호 변경 |
| 이용권 신청 | 요금제 선택 → 입금 계좌 안내 → 입금자명·사업자번호(세금계산서) 입력 |
| 라이선스 | `CK-XXXX-XXXX-XXXX-XXXX` 형식 키, 시작일·만료일, 정지/해제 |
| IP 제한 | 라이선스 하나당 IP 최대 3개(요금제별·라이선스별 조정 가능). **등록된 IP에서만** 프로그램과 저장 기능이 동작 |
| 관리자 | 입금 확인(클릭 한 번으로 발급·연장), 라이선스 직접 발급, 기간 연장, IP 삭제·추가, 회원 관리, 계좌·요금제 설정, 작업 기록 |
| 프로그램 | 착공계 서류 20종 작성·미리보기·PDF 저장. 데이터는 서버에 회원별로 저장 |

## 화면 주소

| 주소 | 누가 | 내용 |
|---|---|---|
| `/login` | 모두 | 로그인 · 회원가입 |
| `/license` | 회원 | 내 라이선스, IP 등록, 이용권 신청(계좌이체), 신청 내역 |
| `/app` | 라이선스+등록 IP | 착공계 프로그램 |
| `/admin` | 관리자 | 관리자 페이지 |

## 판매 흐름

1. 고객이 `/login`에서 회원가입합니다.
2. `/license`에서 이용권을 고르고 입금자명을 적어 신청합니다. 화면에 입금 계좌가 보입니다.
3. 관리자는 통장에서 입금을 확인하고, 관리자 페이지 **입금 확인** 탭에서 「입금 확인」을 누릅니다.
   - 처음 구매: 라이선스 키가 자동 발급되어 고객 계정에 연결됩니다.
   - 연장 구매: 기존 만료일 다음 날부터 기간이 늘어납니다(이미 끝났으면 오늘부터).
4. 고객이 `/license`에서 「이 IP 등록」을 누르면 그 IP에서 프로그램이 열립니다. 최대 3곳까지 등록할 수 있습니다.
5. 고객이 사무실을 옮기는 등 IP가 바뀌면, 관리자가 **라이선스** 탭에서 예전 IP를 삭제해 줍니다. 그러면 고객이 새 IP를 등록할 수 있습니다.

> 세금계산서는 자동 발행되지 않습니다. 신청 내역에 사업자번호·이메일이 표시되니 홈택스 등에서 발행하세요.

## 설치와 실행

### 필요한 것
- Node.js 18 이상 (20 권장)
- 리눅스 서버 1대 (예: AWS Lightsail, 네이버클라우드, 카페24 가상서버 등 월 1~2만 원대 사양이면 충분)
- 도메인 (예: `chakgong.co.kr`)과 HTTPS 인증서 (Let's Encrypt 무료)

### 1) 서버에 올리고 설치
```bash
# 압축을 풀고 폴더로 이동
cd chakgong-server
npm ci --omit=dev
cp .env.example .env
nano .env        # ADMIN_EMAIL, ADMIN_PASSWORD 를 꼭 바꾸세요
```

### 2) 실행
```bash
npm start
# → 착공계 원스톱 서버 실행 중: http://localhost:3000
```
처음 실행할 때 `.env`의 관리자 계정이 만들어집니다. 그 계정으로 `/login`에 로그인하면 관리자 페이지로 이동합니다.

### 3) 계속 켜두기 (pm2)
```bash
sudo npm i -g pm2
pm2 start server.js --name chakgong
pm2 save && pm2 startup
```

### 4) 도메인·HTTPS 연결 (nginx 예시)
```nginx
server {
  server_name chakgong.co.kr;
  client_max_body_size 10m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # 고객의 실제 IP 전달 (IP 제한에 필수)
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
```bash
sudo certbot --nginx -d chakgong.co.kr
```
nginx 뒤에서 운영할 때는 `.env`에 **`TRUST_PROXY=1`**, HTTPS면 **`COOKIE_SECURE=1`**로 두세요.

> ⚠️ `TRUST_PROXY`를 빠뜨리면 모든 고객의 IP가 서버 자신의 IP(127.0.0.1)로 보여서 IP 제한이 제대로 동작하지 않습니다.
> 반대로 프록시 없이 바로 서비스하면서 `TRUST_PROXY=1`을 켜면, 고객이 IP를 속일 수 있습니다. **nginx를 쓸 때만 켜세요.**

### Docker로 실행 (선택)
```bash
docker build -t chakgong .
docker run -d --name chakgong -p 3000:3000 -v chakgong-data:/data \
  -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD='강한비밀번호' -e TRUST_PROXY=1 -e COOKIE_SECURE=1 chakgong
```

## 관리자 첫 설정

1. **설정** 탭: 서비스 이름, 입금 계좌(은행·계좌번호·예금주), 문의처, 안내문을 입력합니다.
   - 입금 계좌가 비어 있으면 고객이 신청할 수 없습니다.
2. **설정 → 이용권**: 기간, 가격, IP 개수를 정합니다. 기본값은 1년 330,000원, 6개월 198,000원, IP 3개입니다.
3. 시범 고객에게 무료로 주려면 **라이선스 → 라이선스 직접 발급**을 씁니다.

## 데이터와 백업

- 모든 데이터는 `data/chakgong.db` 파일 하나(SQLite)에 저장됩니다. 회원, 라이선스, 주문, 고객 프로젝트, 첨부 이미지가 모두 들어 있습니다.
- **매일 백업하세요.** 예시 (매일 새벽 3시, 30일 보관):
```bash
crontab -e
0 3 * * * sqlite3 /경로/chakgong-server/data/chakgong.db ".backup '/backup/chakgong-$(date +\%F).db'" && find /backup -name 'chakgong-*.db' -mtime +30 -delete
```

## IP 제한에 대해 알아둘 점

- 회사 사무실 인터넷처럼 **고정 IP**에서 가장 잘 맞습니다.
- 가정용 인터넷은 가끔, 휴대폰 데이터·공용 와이파이는 자주 IP가 바뀝니다. 바뀌면 고객이 막히므로 관리자에게 IP 삭제를 요청하게 됩니다. 판매 안내문에 「고정 IP(사무실) 기준 3곳」이라고 적어두기를 권합니다.
- IP 제한은 프로그램 화면(`/app`)과 데이터 저장·불러오기 API 모두에 적용됩니다.

## 보안 관련

- 비밀번호는 bcrypt로 암호화해 저장합니다.
- 로그인은 15분에 10번 실패하면 잠시 막힙니다.
- 다른 사이트에서 위조 요청을 보내지 못하도록 API 변경 요청에 확인 헤더를 요구합니다.
- 관리자 작업과 고객의 키 등록·IP 등록은 **작업 기록** 탭에 남습니다.
- 프로그램 화면의 자바스크립트 코드는 고객 브라우저로 내려가므로, 화면 코드 자체를 복사하는 것까지는 막을 수 없습니다. 다만 저장·불러오기는 서버가 라이선스와 IP를 확인한 뒤에만 동작합니다.

## 판매 전 확인 목록 (법률 자문 아님)

- [ ] 사업자등록, 통신판매업 신고
- [ ] 이용약관, 개인정보처리방침 페이지 작성 후 회원가입 화면에 링크 (`views/login.html`의 동의 문구 수정)
- [ ] 환불 규정 안내 (`설정 → 안내문`에 적을 수 있음)
- [ ] 서버 백업 설정
- [ ] 관리자 비밀번호를 강하게, 관리자 계정은 본인만 사용

## 파일 구성

```
server.js        서버 (API, 라이선스·IP 판정, 화면 연결)
db.js            데이터베이스 테이블, 기본 설정
env.js           .env 읽기
views/
  login.html     로그인·회원가입
  license.html   내 라이선스·IP 등록·이용권 신청
  admin.html     관리자 페이지
  app.html       착공계 프로그램
public/
  style.css, common.js
```
