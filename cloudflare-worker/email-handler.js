/**
 * Cloudflare Email Worker — Invendory 쿠팡 메일 수신 핸들러
 *
 * 동작:
 *   1. Cloudflare Email Routing의 catch-all 규칙이 이 Worker로 메일을 라우팅
 *   2. Worker가 raw MIME + 메타데이터를 Firebase Cloud Function에
 *      receiveForwardedEmail로 POST
 *   3. Cloud Function이 파싱 + Firebase 저장
 *
 * 배포:
 *   Cloudflare 대시보드 → Email → Email Workers → Create Worker
 *   → 본 파일 내용 전체를 붙여넣기 → Save and Deploy
 *   → Settings → Variables and Secrets 에
 *        FUNCTION_URL  (일반 변수) = Cloud Function receiveForwardedEmail URL
 *        SHARED_SECRET (Secret)    = appConfig/emailWorkerSecret 과 동일 값
 *     두 개 등록
 *   → Routing rules 에서 catch-all → send to Worker 설정
 */

export default {
  async email(message, env, ctx) {
    try {
      const to = message.to || "";
      const from = message.from || "";
      const subject = message.headers.get("subject") || "";

      // 원시 MIME 읽기
      const reader = message.raw.getReader();
      const chunks = [];
      let total = 0;
      const MAX = 2 * 1024 * 1024; // 2MB 초과 드롭
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX) {
            console.log("[email-worker] too large, drop");
            return;
          }
          chunks.push(value);
        }
      }
      // Uint8Array 합치기
      const full = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        full.set(c, offset);
        offset += c.byteLength;
      }
      // 기본 UTF-8 디코드 (메일이 다른 인코딩이면 Cloud Function에서 part별로 재처리)
      const rawText = new TextDecoder("utf-8", { fatal: false }).decode(full);

      // Cloud Function 호출
      const res = await fetch(env.FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Secret": env.SHARED_SECRET,
        },
        body: JSON.stringify({
          to,
          from,
          subject,
          raw: rawText,
          receivedAt: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.log(`[email-worker] function error ${res.status}: ${body.slice(0, 200)}`);
      } else {
        const json = await res.json().catch(() => ({}));
        console.log(`[email-worker] ok to=${to} parsed=${json.parsed} added=${json.added}`);
      }
    } catch (e) {
      console.log(`[email-worker] exception: ${e.message || e}`);
    }
  },
};
