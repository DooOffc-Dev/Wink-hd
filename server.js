import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import cors from 'cors';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

const BASE_URL = "https://wink.ai";
const STRATEGY_URL = "https://strategy.app.meitudata.com";

const CLIENT_ID = "1189857605";
const VERSION = "5.1.2";
const COUNTRY_CODE = "ID";
const CLIENT_LANGUAGE = "en_US";
const CLIENT_TIMEZONE = "Asia/Jakarta";

const TASK_TYPE = "12";
const CONTENT_TYPE = "1";
const EXT_VALUE = "2";
const TASK_NAME = "Enhancer-Ultra HD";

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function winkEnhance(imageBuffer) {
  const tempPath = join(__dirname, 'temp_input.jpg');
  await fsp.writeFile(tempPath, imageBuffer);

  try {
    const GNUM = crypto.randomUUID();
    const jar = new CookieJar();
    await jar.setCookie(`_sm=${GNUM}; Path=/; Domain=wink.ai`, BASE_URL);
    await jar.setCookie(
      `meitustat=${encodeURIComponent(JSON.stringify({ wgid: GNUM }))}; Path=/; Domain=wink.ai`,
      BASE_URL
    );

    const api = wrapper(axios.create({
      baseURL: BASE_URL,
      jar,
      withCredentials: true,
      validateStatus: () => true,
      headers: {
        accept: "*/*",
        origin: BASE_URL,
        referer: `${BASE_URL}/image-enhancer/upload`,
        "user-agent": UA,
        "sec-ch-ua": "\"Google Chrome\";v=\"147\", \"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"147\"",
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": "\"Android\"",
        ab_info: JSON.stringify({
          ab_codes: [],
          version: "1.4.4"
        })
      }
    }));

    function makeTrace() {
      return `${crypto.randomBytes(16).toString("hex")}-${crypto.randomBytes(8).toString("hex")}-1`;
    }

    function traceHeaders(transaction = "GET%20%2F%5Blocale%5D%2Fimage-enhancer%2Fupload") {
      const trace = makeTrace();
      return {
        "sentry-trace": trace,
        baggage: [
          "sentry-environment=release",
          "sentry-release=5.1.2%20(b60d25c477f43c6dfac4107810f26d442320f4f1)",
          "sentry-public_key=e1bf914f3448d9bc8a10c7e499d17d54",
          `sentry-trace_id=${trace.split("-")[0]}`,
          `sentry-transaction=${transaction}`,
          "sentry-sampled=true",
          "sentry-sample_rate=0.75"
        ].join(",")
      };
    }

    function baseParams(extra = {}) {
      return new URLSearchParams({
        client_id: CLIENT_ID,
        version: VERSION,
        country_code: COUNTRY_CODE,
        gnum: GNUM,
        client_language: CLIENT_LANGUAGE,
        client_channel_id: "",
        client_timezone: CLIENT_TIMEZONE,
        ...extra
      });
    }

    async function getMaatSign() {
      const params = baseParams({
        suffix: ".jpg",
        type: "temp",
        count: "1"
      });

      const res = await api.get(`/api/file/get_maat_sign.json?${params.toString()}`, {
        headers: traceHeaders()
      });

      if (res.status >= 400 || res.data?.code !== 0) {
        throw new Error(`get_maat_sign gagal: ${JSON.stringify(res.data)}`);
      }

      return res.data.data;
    }

    async function getUploadPolicy(sign) {
      const params = new URLSearchParams({
        app: sign.app,
        count: String(sign.count),
        sig: sign.sig,
        sigTime: sign.sig_time,
        sigVersion: sign.sig_version,
        suffix: sign.suffix,
        type: sign.type
      });

      const res = await axios.get(`${STRATEGY_URL}/upload/policy?${params.toString()}`, {
        headers: {
          accept: "*/*",
          origin: BASE_URL,
          referer: `${BASE_URL}/`,
          "user-agent": UA,
          "sec-ch-ua": "\"Google Chrome\";v=\"147\", \"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"147\"",
          "sec-ch-ua-mobile": "?1",
          "sec-ch-ua-platform": "\"Android\""
        },
        validateStatus: () => true
      });

      if (res.status >= 400 || !Array.isArray(res.data) || !res.data[0]?.qiniu) {
        throw new Error(`upload policy gagal: ${JSON.stringify(res.data)}`);
      }

      return res.data[0].qiniu;
    }

    async function uploadToQiniu(policy) {
      const form = new FormData();

      form.append("file", fs.createReadStream(tempPath), {
        filename: "input.jpg",
        contentType: "image/jpeg"
      });

      form.append("token", policy.token);
      form.append("key", policy.key);
      form.append("fname", "input.jpg");

      const res = await axios.post(policy.url, form, {
        headers: form.getHeaders({
          origin: BASE_URL,
          referer: `${BASE_URL}/`,
          "user-agent": UA,
          accept: "*/*"
        }),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true
      });

      if (res.status >= 400) {
        throw new Error(`upload qiniu gagal HTTP ${res.status}`);
      }

      return {
        file_key: policy.key,
        source_url: res.data.url || res.data.data || policy.data,
      };
    }

    async function delivery(sourceUrl) {
      const body = baseParams({
        type: TASK_TYPE,
        content_type: CONTENT_TYPE,
        source_url: sourceUrl,
        type_params: JSON.stringify({
          is_mirror: 0,
          orientation_tag: 1,
          j_420_trans: "1",
          return_ext: "2"
        }),
        right_detail: JSON.stringify({
          source: "1",
          touch_type: "4",
          function_id: "630",
          material_id: "63011",
          url: "https://wink.ai/image-enhancer/upload"
        }),
        ext_params: JSON.stringify({
          task_name: TASK_NAME,
          records: TASK_TYPE
        }),
        with_prepare: "1"
      });

      const res = await api.post("/api/meitu_ai/delivery.json", body.toString(), {
        headers: {
          ...traceHeaders(),
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
        }
      });

      if (res.status >= 400 || res.data?.code !== 0) {
        throw new Error(`delivery gagal: ${JSON.stringify(res.data)}`);
      }

      return res.data.data;
    }

    async function queryBatch(msgId) {
      const params = baseParams({ msg_ids: msgId });
      const res = await api.get(`/api/meitu_ai/query_batch.json?${params.toString()}`, {
        headers: {
          ...traceHeaders("%2F%3Alocale%2Feditor%2Frecent-task"),
          referer: `${BASE_URL}/image-enhancer/upload`
        }
      });

      if (res.status >= 400 || res.data?.code !== 0) {
        throw new Error(`query batch gagal: ${JSON.stringify(res.data)}`);
      }

      return res.data.data;
    }

    async function waitResult(firstMsgId, maxTry = 80, delayMs = 3000) {
      let msgId = firstMsgId;
      for (let i = 1; i <= maxTry; i++) {
        const data = await queryBatch(msgId);
        const item = data?.item_list?.[0];
        const media = item?.result?.media_info_list?.[0];
        const url = media?.media_data || "";
        const errorCode = item?.result?.error_code;

        if (url && url.startsWith("http") && errorCode === 0) {
          return url;
        }

        if (errorCode && errorCode !== 29901 && errorCode !== 0) {
          throw new Error(`task gagal: ${errorCode}`);
        }

        await sleep(delayMs);
      }
      throw new Error(`result belum selesai`);
    }

    const sign = await getMaatSign();
    const policy = await getUploadPolicy(sign);
    const uploaded = await uploadToQiniu(policy);
    const task = await delivery(uploaded.source_url);
    const firstMsgId = task.msg_id || task.prepare_msg_id;
    const resultUrl = await waitResult(firstMsgId);

    return resultUrl;
  } finally {
    await fsp.unlink(tempPath).catch(() => {});
  }
}

app.use(express.static('public'));

app.post('/enhance', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) throw new Error('Gambar tidak ditemukan');

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    const resultUrl = await winkEnhance(buffer);
    res.json({ success: true, resultUrl });
  } catch (error) {
    console.error('🔥 ERROR ENHANCE:', error.message);
    res.status(500).json({ error: 'Gagal enhance gambar', message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🔥 Wink HD Web running on port ${PORT}`);
});
