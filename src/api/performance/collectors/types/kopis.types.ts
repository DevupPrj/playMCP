export interface KopisItemRaw {
  mt20id: string[]; // ID
  prfnm: string[]; // 제목
  genrenm: string[]; // 장르
  prfpdfrom: string[]; // 시작일
  prfpdto: string[]; // 종료일
  poster: string[]; // 포스터
  fcltynm: string[]; // 장소
  openrun: string[]; // 오픈런 여부
}

export interface KopisDetailRaw {
  mt20id: string[]; // 공연 ID
  prfnm: string[]; // 공연명
  prfpdfrom: string[]; // 시작일
  prfpdto: string[]; // 종료일
  fcltynm: string[]; // 장소명
  prfcast?: string[]; // 출연진
  pcseguidance?: string[]; // 가격
  poster?: string[]; // 포스터 URL
  sty?: string[]; // 📜 줄거리 (비어있을 수 있음!)
  genrenm?: string[]; // 장르
  prfstate?: string[]; // 공연 상태
  dtguidance?: string[]; // 공연 시간
  relates?: {
    relate?: {
      relatenm: string[];
      relateurl: string[];
    }[];
  }[];
}

export interface KopisResponse<T> {
  dbs: {
    db: T[];
  };
}
