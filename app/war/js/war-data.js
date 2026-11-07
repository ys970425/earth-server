// 전쟁 버전 데이터 불러오기
// ?preview=real 이면 실제 데이터(preview/state-real.json)를, 그 밖의 preview 값(?preview=1 등)이면
// 가짜 데이터(preview/state.json)를 읽어요. state-real.json은 깃허브에 올라가지 않아요.
// 아직은 Supabase에 연결하지 않아요 (서버 연결은 이후 단계에서 넣어요).
(function () {
  const WarData = {
    // 어느 미리보기인지: 'real' / 'fake' / null (미리보기 아님)
    mode() {
      const v = new URLSearchParams(location.search).get('preview');
      if (v === 'real') return 'real';
      if (v != null) return 'fake';
      return null;
    },
    isPreview() { return this.mode() !== null; },
    // 미리보기 모드면 데이터를 돌려주고, 아니면 null을 돌려줘요
    async load() {
      const mode = this.mode();
      if (!mode) return null;
      const r = await fetch(mode === 'real' ? 'preview/state-real.json' : 'preview/state.json');
      if (!r.ok) throw new Error(mode === 'real'
        ? '실제 데이터 미리보기 파일이 없어요. private 폴더에 무역 백업 파일을 넣고, 터미널에서 npm run war:preview:real 을 실행해 주세요.'
        : '미리보기 파일이 없어요. 터미널에서 npm run war:preview 를 먼저 실행해 주세요.');
      return r.json();
    }
  };
  window.WarData = WarData;
})();
