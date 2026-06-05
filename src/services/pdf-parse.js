// 브라우저에서 PDF 의 텍스트 레이어를 추출하고, 얼마나 파싱됐는지(스캔/이미지 PDF 여부 포함) 측정한다.
// 빌드 도구가 없는 프로젝트라 pdf.js 는 필요 시에만 CDN(ESM) 에서 동적 import 한다.
// worker 와 본체는 버전이 정확히 일치해야 하므로 같은 버전으로 고정한다.

const PDFJS_VERSION = "4.7.76";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;

let pdfjsPromise = null;

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(`${PDFJS_BASE}/pdf.min.mjs`)
      .then((pdfjsLib) => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
        return pdfjsLib;
      })
      .catch((err) => {
        pdfjsPromise = null; // 다음 시도에서 다시 로드할 수 있게 캐시를 비운다.
        throw new Error("PDF 파싱 모듈(pdf.js)을 불러오지 못했습니다. 네트워크 연결을 확인해주세요.");
      });
  }
  return pdfjsPromise;
}

// dataURL("data:application/pdf;base64,XXXX") → Uint8Array
function dataUrlToUint8(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// 한 페이지에 '의미 있는 텍스트'가 있다고 볼 최소 글자 수.
const MIN_CHARS_PER_PAGE = 20;
// 페이지당 평균 글자수가 이보다 적으면 스캔/이미지 PDF(텍스트 레이어 없음)로 본다.
const IMAGE_AVG_CHARS_THRESHOLD = 50;

// PDF dataURL 을 받아 전체 텍스트와 파싱 품질 지표를 돌려준다.
// 반환: { text, pageCount, charCount, pagesWithText, imageLikely }
export async function parsePdfText(dataUrl, { mimeType } = {}) {
  if (mimeType && !/pdf/i.test(mimeType)) {
    throw new Error(`PDF 형식만 텍스트 파싱을 지원합니다. (현재 형식: ${mimeType})`);
  }

  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: dataUrlToUint8(dataUrl) }).promise;

  const pageTexts = [];
  let pagesWithText = 0;
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => (typeof item.str === "string" ? item.str : ""))
      .join(" ")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    if (pageText.length >= MIN_CHARS_PER_PAGE) pagesWithText++;
    pageTexts.push(pageText);
  }

  const text = pageTexts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  const pageCount = pdf.numPages;
  const charCount = text.length;
  const avgCharsPerPage = pageCount ? charCount / pageCount : 0;
  // 텍스트가 거의 없으면(또는 어떤 페이지에서도 텍스트를 못 찾으면) 이미지 PDF 로 판단한다.
  const imageLikely = pageCount > 0 && (avgCharsPerPage < IMAGE_AVG_CHARS_THRESHOLD || pagesWithText === 0);

  return { text, pageCount, charCount, pagesWithText, imageLikely };
}
