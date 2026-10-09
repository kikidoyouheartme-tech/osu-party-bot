export interface CommunityChoiceMap {
    year: number;
    beatmapsetId: number;
    beatmapId: number;
    title: string;
    artist: string;
    diffName: string;
  }
  
  export const COMMUNITY_CHOICE_MAPS: CommunityChoiceMap[] = [
    { year: 2025, beatmapsetId: 2235601, beatmapId: 4956471, title: 'Temptation (feat. Rebecca) (Nightcore Mix)', artist: 'Arash', diffName: '~Farewell~' },
    { year: 2024, beatmapsetId: 2095154, beatmapId: 4393036, title: 'Burning Star', artist: 'LV.4', diffName: 'Burn Out' },
    { year: 2023, beatmapsetId: 2088431, beatmapId: 4376532, title: 'Hinarin no Yakui Kankei (Edit ver.)', artist: 'IOSYS', diffName: 'Kuru-kurunatic' },
    { year: 2022, beatmapsetId: 1889729, beatmapId: 3912664, title: 'Non-breath oblige', artist: '15 Voices', diffName: 'no buresu' },
    { year: 2021, beatmapsetId: 1357624, beatmapId: 2809623, title: 'true DJ MAG top rankers song Zenpen (katagiri Remix)', artist: 'sabi', diffName: 'KEMOMIMI EDM SQUAD' },
    { year: 2020, beatmapsetId: 1147361, beatmapId: 2395803, title: 'DADDY ! DADDY ! DO ! feat. Suzuki Airi (TV Size)', artist: 'Suzuki Masayuki', diffName: 'Confession?' },
    { year: 2019, beatmapsetId: 413117, beatmapId: 960875, title: 'Ghost Rule', artist: 'DECO*27', diffName: 'MayDay' },
    { year: 2018, beatmapsetId: 874948, beatmapId: 1828562, title: 'POP/STARS (ft. Madison Beer, (G)I-DLE, Jaira Burns)', artist: 'K/DA', diffName: 'handsomes Master' },
    { year: 2017, beatmapsetId: 596704, beatmapId: 1262832, title: 'Hitorigoto -TV MIX-', artist: 'ClariS', diffName: 'Soliloquy' },
    { year: 2016, beatmapsetId: 482090, beatmapId: 1028733, title: 'Inferno', artist: '9mm Parabellum Bullet', diffName: 'The Eclipse' },
    { year: 2015, beatmapsetId: 332532, beatmapId: 736215, title: 'Highscore', artist: 'Panda Eyes & Teminite', diffName: 'Game Over' },
    { year: 2014, beatmapsetId: 190222, beatmapId: 453042, title: 'IGNITE (TV size ver.)', artist: 'Aoi Eir', diffName: 'Insane' },
  ];
  
  export function getRandomCommunityChoiceMap(): CommunityChoiceMap {
    const index = Math.floor(Math.random() * COMMUNITY_CHOICE_MAPS.length);
    return COMMUNITY_CHOICE_MAPS[index];
  }