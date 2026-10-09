export interface LovedMap {
    beatmapsetId: number;
    beatmapId: number;
  }
  
  export const LOVED_CLASSICS_MAPS: Record<number, LovedMap[]> = {
    2009: [
      { beatmapsetId: 7385, beatmapId: 31819 },
      { beatmapsetId: 5807, beatmapId: 27637 },
    ],
    2016: [
      { beatmapsetId: 396221, beatmapId: 924759 },
      { beatmapsetId: 291155, beatmapId: 683970 },
      { beatmapsetId: 137394, beatmapId: 894011 },
      { beatmapsetId: 223370, beatmapId: 686421 },
      { beatmapsetId: 291154, beatmapId: 655679 },
      { beatmapsetId: 318036, beatmapId: 708367 },
    ],
    2017: [
      { beatmapsetId: 524026, beatmapId: 1126228 },
      { beatmapsetId: 548907, beatmapId: 1162426 },
      { beatmapsetId: 632870, beatmapId: 1344602 },
      { beatmapsetId: 536872, beatmapId: 1137879 },
    ],
    2018: [
      { beatmapsetId: 813569, beatmapId: 1706210 },
      { beatmapsetId: 147210, beatmapId: 364532 },
      { beatmapsetId: 288824, beatmapId: 1129193 },
      { beatmapsetId: 252981, beatmapId: 674349 },
    ],
    2019: [
      { beatmapsetId: 934878, beatmapId: 1951721 },
      { beatmapsetId: 685822, beatmapId: 2202862 },
      { beatmapsetId: 814850, beatmapId: 1777756 },
      { beatmapsetId: 454079, beatmapId: 1399240 },
      { beatmapsetId: 833927, beatmapId: 1746902 },
      { beatmapsetId: 836053, beatmapId: 1762037 },
    ],
    2020: [
      { beatmapsetId: 914449, beatmapId: 1909963 },
      { beatmapsetId: 358119, beatmapId: 788979 },
      { beatmapsetId: 778719, beatmapId: 2125723 },
      { beatmapsetId: 407055, beatmapId: 1185311 },
    ],
    2021: [
      { beatmapsetId: 783213, beatmapId: 1644535 },
      { beatmapsetId: 1080535, beatmapId: 2266572 },
      { beatmapsetId: 1171250, beatmapId: 2443190 },
      { beatmapsetId: 740853, beatmapId: 1886839 },
    ],
    2022: [
      { beatmapsetId: 1343420, beatmapId: 2937933 },
      { beatmapsetId: 1746664, beatmapId: 3572698 },
      { beatmapsetId: 1024321, beatmapId: 2732387 },
      { beatmapsetId: 1526448, beatmapId: 3607095 },
      { beatmapsetId: 1113116, beatmapId: 2325387 },
    ],
    2023: [
      { beatmapsetId: 1742920, beatmapId: 3632631 },
      { beatmapsetId: 1245673, beatmapId: 2619459 },
      { beatmapsetId: 671722, beatmapId: 1653225 },
    ],
    2024: [
      { beatmapsetId: 865575, beatmapId: 1809845 },
      { beatmapsetId: 1231048, beatmapId: 2559287 },
      { beatmapsetId: 2053038, beatmapId: 4736984 },
    ],
    2025: [
      { beatmapsetId: 1711618, beatmapId: 3505066 },
      { beatmapsetId: 2071283, beatmapId: 4820704 },
      { beatmapsetId: 1982563, beatmapId: 4866637 },
    ],
    2026: [
      { beatmapsetId: 90935, beatmapId: 5564129 },
      { beatmapsetId: 2158411, beatmapId: 4550417 },
      { beatmapsetId: 1607179, beatmapId: 3283421 },
      { beatmapsetId: 2149436, beatmapId: 4886197 },
    ],
  };
  
  export function getRandomLovedClassicsMap(): { year: number; map: LovedMap } {
    const years = Object.keys(LOVED_CLASSICS_MAPS).map(Number);
    const randomYear = years[Math.floor(Math.random() * years.length)];
    const mapsForYear = LOVED_CLASSICS_MAPS[randomYear];
    const randomMap = mapsForYear[Math.floor(Math.random() * mapsForYear.length)];
    return { year: randomYear, map: randomMap };
  }