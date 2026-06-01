// 첨부 서류용 드래그앤드랍 영역 헬퍼.
// Checklist가 렌더한 [data-dropzone] 요소(label + 숨김 file input)에
// 드래그/드롭/클릭 선택 동작을 붙이고, 선택된 파일을 onFile 콜백으로 넘긴다.

/**
 * root 내부의 모든 드롭존에 파일 선택/드롭 핸들러를 연결한다.
 * @param {ParentNode} root
 * @param {(documentType: string, file: File) => void} onFile
 */
export function wireDropzones(root, onFile) {
  root.querySelectorAll("[data-dropzone]").forEach((zone) => {
    const input = zone.querySelector("input[type=file]");
    const documentType = zone.dataset.documentType;

    if (input) {
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        input.value = ""; // 같은 파일을 다시 선택해도 change가 발생하도록 초기화
        if (file) onFile(documentType, file);
      });
    }

    ["dragenter", "dragover"].forEach((type) => {
      zone.addEventListener(type, (event) => {
        event.preventDefault();
        zone.classList.add("is-dragover");
      });
    });
    ["dragleave", "dragend"].forEach((type) => {
      zone.addEventListener(type, () => zone.classList.remove("is-dragover"));
    });
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragover");
      const file = event.dataTransfer?.files?.[0];
      if (file) onFile(documentType, file);
    });
  });
}

/**
 * 임시 file input을 띄워 파일 한 개를 고른다(드롭존이 없는 '수정' 버튼 등에서 사용).
 * @param {(file: File) => void} onPick
 */
export function pickFile(onPick) {
  const input = document.createElement("input");
  input.type = "file";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) onPick(file);
  });
  input.click();
}

/**
 * 아직 업로드 전(메모리에만 보관 중)인 파일을 드롭존에 표시하고 제거 버튼을 단다.
 * @param {HTMLElement} zone
 * @param {string} fileName
 * @param {() => void} onRemove
 */
export function showDropzoneFile(zone, fileName, onRemove) {
  zone.classList.add("is-filled");
  const text = zone.querySelector(".doc-dropzone-text");
  if (text) text.textContent = fileName;
  const icon = zone.querySelector(".doc-dropzone-icon");
  if (icon) icon.textContent = "📎";

  if (onRemove && !zone.querySelector(".doc-dropzone-remove")) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "doc-dropzone-remove";
    remove.setAttribute("aria-label", "선택한 파일 제거");
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      // label 내부 버튼이라 기본 동작(파일 대화상자 열림)을 막는다.
      event.preventDefault();
      event.stopPropagation();
      onRemove();
    });
    zone.appendChild(remove);
  }
}
