// 전쟁 버전 데이터 불러오기 (W2)
// ?preview=1 이면 가짜 데이터 파일(preview/state.json)을 읽어요.
// 아직은 Supabase에 연결하지 않아요 (서버 연결은 이후 단계에서 넣어요).
(function () {
  const WarData = {
    // 미리보기 모드인지 (주소 끝에 ?preview=1)
    isPreview() { return new URLSearchParams(location.search).has('preview'); },
    // 미리보기 모드면 state.json을 돌려주고, 아니면 null을 돌려줘요
    async load() {
      if (!this.isPreview()) return null;
      const r = await fetch('preview/state.json');
      if (!r.ok) throw new Error('미리보기 파일이 없어요. 터미널에서 npm run war:preview 를 먼저 실행해 주세요.');
      return r.json();
    }
  };
  window.WarData = WarData;
})();
