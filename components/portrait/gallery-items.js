// Figma Main: image slots and transforms relative to Dust 2 / Space 2.
// Wood is shifted 70px left / 38px up to balance its gaps to fire and Chinese.
// Reusable frame styles only. Each pass gets its own content entry in gallery-sequence.js.
export const FRAME_ITEMS = [
  {
    "id": "24:588",
    "order": 22,
    "name": "复古木质相框",
    "src": "../../Assets/Frame/复古木质相框.png",
    "scene": 0,
    "material": "wood",
    "size": [
      413.92724609375,
      310.4454345703125
    ],
    "matrix": [
      0.9046981334686279,
      0.4260531961917877,
      -0.4260531961917877,
      0.9046981334686279,
      -26.5828857421875,
      -85.29833984375
    ]
  },
  {
    "id": "24:590",
    "order": 9,
    "name": "中世纪鎏金竖",
    "src": "../../Assets/optimized/Portrait/frames/gilded.webp",
    "scene": 0,
    "material": "gold",
    "size": [
      359.03662109375,
      538.554931640625
    ],
    "matrix": [
      0.8787531852722168,
      0.477276474237442,
      -0.477276474237442,
      0.8787531852722168,
      1045.03955078125,
      255
    ]
  },
  {
    "id": "24:591",
    "order": 10,
    "name": "欧式雕花装饰边框",
    "src": "../../Assets/optimized/Portrait/frames/european.webp",
    "scene": 0,
    "material": "stone",
    "size": [
      448.917236328125,
      561.8473510742188
    ],
    "matrix": [
      0.8326700925827026,
      0.5537694096565247,
      -0.5537694096565247,
      0.8326700925827026,
      1386.1337890625,
      487
    ]
  },
  {
    "id": "24:598",
    "order": 11,
    "name": "中式相框",
    "src": "../../Assets/Frame/中式相框.png",
    "scene": 0,
    "material": "wood",
    "size": [
      511.74493408203125,
      409.3959655761719
    ],
    "matrix": [
      -0.8367786407470703,
      -0.5475413799285889,
      -0.5475413799285889,
      0.8367786407470703,
      927.37841796875,
      317.20166015625
    ]
  },
  {
    "id": "24:592",
    "order": 23,
    "name": "冰相框",
    "src": "../../Assets/Frame/冰相框.png",
    "scene": 1,
    "material": "ice",
    "size": [
      600.4910278320312,
      400.3273620605469
    ],
    "matrix": [
      0.6568106412887573,
      -0.7540555596351624,
      0.7540555596351624,
      0.6568106412887573,
      1034,
      222.8037109375
    ]
  },
  {
    "id": "24:594",
    "order": 17,
    "name": "液态边框",
    "src": "../../Assets/Frame/液态边框.png",
    "scene": 1,
    "material": "liquid",
    "size": [
      537.212646484375,
      358.14178466796875
    ],
    "matrix": [
      -0.32951822876930237,
      -0.9441492557525635,
      0.9441492557525635,
      -0.32951822876930237,
      442.021240234375,
      943.22314453125
    ]
  },
  {
    "id": "24:596",
    "order": 19,
    "name": "花卉画框",
    "src": "../../Assets/Frame/花卉画框.png",
    "scene": 1,
    "material": "flower",
    "size": [
      591.1787719726562,
      394.1191711425781
    ],
    "matrix": [
      0.950799286365509,
      -0.30980753898620605,
      0.30980753898620605,
      0.950799286365509,
      -251,
      780.15185546875
    ]
  },
  {
    "id": "24:597",
    "order": 18,
    "name": "银框",
    "src": "../../Assets/Frame/银框.png",
    "scene": 1,
    "material": "silver",
    "size": [
      523.1903076171875,
      418.7015075683594
    ],
    "matrix": [
      0.7409842014312744,
      -0.6715224385261536,
      0.6715224385261536,
      0.7409842014312744,
      713,
      597.333984375
    ]
  }
];

// The fifth Dust slot sits just upstream of the initial four. Its spacing is
// part of every repeated arrangement, with no separate delay or return timer.
FRAME_ITEMS.push({
  id: 'dust-fire', name: '火焰相框', src: '../../Assets/optimized/Frame/火焰相框.webp',
  scene: 0, material: 'fire', size: [480, 320],
  matrix: [.970296, .241922, -.241922, .970296, -590, -305],
  initial: false,
});

FRAME_ITEMS.sort((a, b) => (a.order ?? 24) - (b.order ?? 24));
