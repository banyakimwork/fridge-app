/* 시드 데이터: 칸 구조 · 카테고리 팔레트 · 재료 사전
   칸 구조는 2026-08-09 실물 사진 실측 (PRD §4.1) */

const CATEGORIES = [
  { id: 'vegetable', name: '채소',      h: 128, s: 45 },
  { id: 'fruit',     name: '과일',      h:  20, s: 78 },
  { id: 'meat',      name: '육류',      h: 352, s: 50 },
  { id: 'seafood',   name: '수산',      h: 188, s: 48 },
  { id: 'dairy',     name: '유제품',    h:  48, s: 55 },
  { id: 'egg',       name: '계란',      h:  58, s: 85 },
  { id: 'processed', name: '두부·가공', h:  28, s: 18 },
  { id: 'sauce',     name: '소스·양념', h:  14, s: 40 },
  { id: 'drink',     name: '음료',      h: 212, s: 55 },
  { id: 'grain',     name: '밥·면·빵',  h:  35, s: 38 },
  { id: 'side',      name: '반찬·국',   h: 318, s: 38 },
  { id: 'etc',       name: '기타',      h: 220, s:  6 },
];

/* 상단 탭 순서 = 이 배열 순서 (좌우 스와이프도 이 순서로 넘어간다).
   팬트리는 칸 3개를 위에서 아래로 쌓는다 (1열 3단, 폭은 화면 전체). */
const UNITS = [
  { id: 'fridge',  name: '냉장고', icon: '🧊' },
  { id: 'freezer', name: '냉동고', icon: '❄️' },
  { id: 'pantry',  name: '팬트리', icon: '🥫' },
];

/* unit: fridge | freezer | pantry
   kind: shelf | drawer | door
   track: expiry(기한 카운트다운) | elapsed(경과일) | none(표시 없음)
   팬트리는 expiry지만 기한이 비어 있어도 된다 — 실온 보관이라 대부분 몇 달을 가고,
   빵·바나나처럼 금방 상하는 것만 날짜를 넣으면 그때부터 꼬리표가 붙는다. */
const COMPARTMENTS = [
  // ── 냉장고 본체 (선반 5 + 서랍 2)
  { id: 'fridge-shelf-1',  unit: 'fridge', kind: 'shelf',  track: 'expiry',  label: '1번 선반' },
  { id: 'fridge-shelf-2',  unit: 'fridge', kind: 'shelf',  track: 'expiry',  label: '2번 선반 · 와인랙' },
  { id: 'fridge-shelf-3',  unit: 'fridge', kind: 'shelf',  track: 'expiry',  label: '3번 선반' },
  { id: 'fridge-shelf-4',  unit: 'fridge', kind: 'shelf',  track: 'expiry',  label: '4번 선반' },
  { id: 'fridge-shelf-5',  unit: 'fridge', kind: 'shelf',  track: 'expiry',  label: '5번 선반' },
  { id: 'fridge-drawer-1', unit: 'fridge', kind: 'drawer', track: 'expiry',  label: '위 서랍' },
  { id: 'fridge-drawer-2', unit: 'fridge', kind: 'drawer', track: 'expiry',  label: '아래 서랍' },
  // ── 냉장고 도어 (포켓 5) — 기한 표시 없음
  { id: 'fridge-door-1',   unit: 'fridge', kind: 'door',   track: 'none',    label: '도어 1' },
  { id: 'fridge-door-2',   unit: 'fridge', kind: 'door',   track: 'none',    label: '도어 2' },
  { id: 'fridge-door-3',   unit: 'fridge', kind: 'door',   track: 'none',    label: '도어 3' },
  { id: 'fridge-door-4',   unit: 'fridge', kind: 'door',   track: 'none',    label: '도어 4' },
  { id: 'fridge-door-5',   unit: 'fridge', kind: 'door',   track: 'none',    label: '도어 5' },
  // ── 냉동고 (선반 3 + 서랍 4), 도어 포켓 없음
  { id: 'freezer-shelf-1',  unit: 'freezer', kind: 'shelf',  track: 'elapsed', label: '1번 선반' },
  { id: 'freezer-shelf-2',  unit: 'freezer', kind: 'shelf',  track: 'elapsed', label: '2번 선반 · 제빙기' },
  { id: 'freezer-shelf-3',  unit: 'freezer', kind: 'shelf',  track: 'elapsed', label: '3번 선반' },
  { id: 'freezer-drawer-1', unit: 'freezer', kind: 'drawer', track: 'elapsed', label: '1번 서랍' },
  { id: 'freezer-drawer-2', unit: 'freezer', kind: 'drawer', track: 'elapsed', label: '2번 서랍' },
  { id: 'freezer-drawer-3', unit: 'freezer', kind: 'drawer', track: 'elapsed', label: '3번 서랍' },
  { id: 'freezer-drawer-4', unit: 'freezer', kind: 'drawer', track: 'elapsed', label: '4번 서랍' },
  // ── 팬트리 (실온, 위에서부터 1~3칸 세로로 쌓음) — 2026-11-08 추가
  { id: 'pantry-shelf-1',   unit: 'pantry',  kind: 'shelf',  track: 'expiry',  label: '1칸' },
  { id: 'pantry-shelf-2',   unit: 'pantry',  kind: 'shelf',  track: 'expiry',  label: '2칸' },
  { id: 'pantry-shelf-3',   unit: 'pantry',  kind: 'shelf',  track: 'expiry',  label: '3칸' },
];

/* [이름, 카테고리, 냉장 기준 통상 보관일] */
const PRESETS = [
  // 채소
  ['시금치','vegetable',5],['상추','vegetable',5],['양배추','vegetable',14],['대파','vegetable',10],
  ['쪽파','vegetable',7],['양파','vegetable',21],['마늘','vegetable',30],['다진마늘','vegetable',14],
  ['당근','vegetable',21],['감자','vegetable',30],['고구마','vegetable',21],['애호박','vegetable',7],
  ['오이','vegetable',7],['가지','vegetable',7],['파프리카','vegetable',10],['피망','vegetable',10],
  ['방울토마토','vegetable',7],['토마토','vegetable',7],['브로콜리','vegetable',7],['버섯','vegetable',7],
  ['느타리버섯','vegetable',5],['팽이버섯','vegetable',7],['새송이버섯','vegetable',10],['부추','vegetable',5],
  ['깻잎','vegetable',7],['청경채','vegetable',5],['배추','vegetable',14],['무','vegetable',21],
  ['콩나물','vegetable',3],['숙주','vegetable',3],['셀러리','vegetable',10],['아스파라거스','vegetable',5],
  ['생강','vegetable',21],['고추','vegetable',10],['아보카도','vegetable',5],
  // 과일
  ['사과','fruit',21],['배','fruit',14],['바나나','fruit',5],['딸기','fruit',4],
  ['포도','fruit',7],['블루베리','fruit',7],['오렌지','fruit',14],['레몬','fruit',21],
  ['키위','fruit',10],['복숭아','fruit',5],['참외','fruit',7],['수박','fruit',5],
  ['샤인머스캣','fruit',7],['귤','fruit',10],['망고','fruit',5],
  // 육류
  ['삼겹살','meat',3],['목살','meat',3],['앞다리살','meat',3],['소고기','meat',3],
  ['다짐육','meat',2],['닭가슴살','meat',3],['닭다리','meat',3],['닭한마리','meat',2],
  ['베이컨','meat',7],['소시지','meat',14],['햄','meat',10],['오리고기','meat',3],
  // 수산
  ['새우','seafood',2],['연어','seafood',2],['고등어','seafood',2],['오징어','seafood',2],
  ['조개','seafood',2],['멸치','seafood',30],['명란젓','seafood',14],['어묵','seafood',7],
  // 유제품
  ['우유','dairy',7],['저지방우유','dairy',7],['두유','dairy',10],['요거트','dairy',10],
  ['그릭요거트','dairy',10],['치즈','dairy',21],['모짜렐라','dairy',10],['버터','dairy',60],
  ['생크림','dairy',7],['크림치즈','dairy',14],['사워크림','dairy',14],
  // 계란
  ['계란','egg',21],['메추리알','egg',14],['삶은계란','egg',5],
  // 두부·가공
  ['두부','processed',5],['순두부','processed',5],['유부','processed',10],['만두','processed',7],
  ['떡','processed',5],['어묵바','processed',7],['맛살','processed',14],['콩나물무침','processed',3],
  // 소스·양념
  ['간장','sauce',180],['고추장','sauce',180],['된장','sauce',180],['쌈장','sauce',120],
  ['참기름','sauce',180],['들기름','sauce',120],['식초','sauce',365],['맛술','sauce',180],
  ['굴소스','sauce',180],['마요네즈','sauce',90],['케찹','sauce',180],['머스타드','sauce',180],
  ['스리라차','sauce',180],['올리브오일','sauce',180],['잼','sauce',90],['꿀','sauce',365],
  ['메이플시럽','sauce',180],['액젓','sauce',365],['다시다','sauce',365],['후추','sauce',365],
  // 음료
  ['생수','drink',180],['탄산수','drink',180],['맥주','drink',120],['와인','drink',30],
  ['주스','drink',10],['커피','drink',7],['콜라','drink',120],['막걸리','drink',10],
  // 밥·면·빵
  ['밥','grain',3],['식빵','grain',5],['바게트','grain',3],['국수','grain',180],
  ['백미','grain',365],['현미','grain',365],['잡곡','grain',365],['찹쌀','grain',365],
  ['냉면','grain',30],['우동면','grain',14],['또띠아','grain',30],['크로와상','grain',3],
  // 반찬·국
  ['김치','side',90],['깍두기','side',60],['나물','side',3],['장조림','side',10],
  ['멸치볶음','side',14],['된장국','side',3],['미역국','side',3],['카레','side',4],
  ['불고기','side',3],['잡채','side',3],
];

/* ─────────── 카테고리 추론 ───────────
   사전에 없는 이름(「곤드레밥」「레몬커드」「얼린대파」)이 전부 '기타'로 떨어지면
   카테고리 색이 의미를 잃는다. 이름의 생김새로 찍어준다.

   순서가 규칙이다: 요리 형태(끝말)가 재료(속말)를 이긴다.
   「양배추참치덮밥」은 채소가 아니라 밥이고, 「레몬커드」는 과일이 아니라 잼이다. */

/* 앞에 붙어도 정체가 안 바뀌는 말 — 떼고 다시 본다 */
const NAME_PREFIXES = ['얼린', '냉동', '생', '손질', '삶은', '데친', '구운', '볶은', '남은', '다진', '슬라이스'];

/* [끝말, 카테고리, 통상 보관일]. 위에서부터 먼저 걸리는 것을 쓴다 */
const NAME_SUFFIXES = [
  // 밥·면·빵 — 「덮밥」이 「밥」보다 먼저 걸리도록 긴 것을 위에
  ['볶음밥','grain',3],['비빔밥','grain',2],['주먹밥','grain',2],['김밥','grain',1],['덮밥','grain',2],['밥','grain',3],
  ['국수','grain',3],['라면','grain',180],['파스타','grain',5],['우동','grain',5],['냉면','grain',30],['면','grain',7],
  ['식빵','grain',5],['베이글','grain',5],['토스트','grain',3],['케이크','grain',3],['빵','grain',4],['또띠아','grain',30],
  ['수제비','grain',3],['쌀','grain',365],
  // 반찬·국 (조리된 것)
  ['찌개','side',3],['전골','side',3],['국','side',3],['탕','side',3],
  ['조림','side',7],['무침','side',3],['볶음','side',4],['나물','side',3],
  ['장아찌','side',90],['절임','side',60],['김치','side',90],['튀김','side',2],['구이','side',3],['샐러드','side',2],
  ['말이','side',3],['찜','side',3],['전','side',3],
  // 소스·양념
  ['커드','sauce',30],['잼','sauce',90],['스프레드','sauce',60],['시럽','sauce',180],['소스','sauce',90],
  ['드레싱','sauce',60],['오일','sauce',180],['기름','sauce',180],['식초','sauce',365],['액젓','sauce',365],
  ['고추장','sauce',180],['된장','sauce',180],['쌈장','sauce',120],['장','sauce',180],
  // 유제품
  ['요거트','dairy',10],['요구르트','dairy',10],['치즈','dairy',21],['버터','dairy',60],['크림','dairy',7],['우유','dairy',7],
  // 음료
  ['주스','drink',10],['에이드','drink',10],['라떼','drink',5],['맥주','drink',120],['와인','drink',30],
  ['소주','drink',365],['막걸리','drink',10],['탄산수','drink',180],
  ['아메리카노','drink',3],['콜드브루','drink',7],['커피','drink',7],['차','drink',30],
  // 육류·수산
  ['삼겹','meat',3],['살','meat',3],['고기','meat',3],['소시지','meat',14],['베이컨','meat',7],
  ['젓','seafood',14],['어묵','seafood',7],['회','seafood',1],
  // 계란
  ['계란','egg',21],['달걀','egg',21],
];

/* 끝말로 못 잡았을 때 쓰는 카테고리별 기본 보관일 */
const CATEGORY_DAYS = {
  vegetable: 7, fruit: 7, meat: 3, seafood: 2, dairy: 10, egg: 21,
  processed: 7, sauce: 90, drink: 30, grain: 5, side: 4, etc: 7,
};
