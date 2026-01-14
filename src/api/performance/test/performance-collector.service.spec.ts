import { Test, TestingModule } from '@nestjs/testing';
import { PerformanceCollectorService } from '../performance-collector.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Performance } from '../entities/performance.entity';
import { of } from 'rxjs';
import { Repository } from 'typeorm';

const MOCK_LIST_XML = `
<dbs>
    <db>
        <mt20id>PF123456</mt20id>
    </db>
</dbs>
`;

const MOCK_EMPTY_XML = `
<dbs></dbs>
`;

const MOCK_DETAIL_XML = `
<dbs>
    <db>
        <mt20id>PF123456</mt20id>
        <prfnm>테스트 공연</prfnm>
        <genrenm>연극</genrenm>
        <prfpdfrom>2026.01.01</prfpdfrom>
        <prfpdto>2026.01.31</prfpdto>
        <fcltynm>예술의전당</fcltynm>
        <dtguidance>화~금 19:30</dtguidance>
        <pcseguidance>R석 50,000원</pcseguidance>
        <poster>http://image.url/poster.jpg</poster>
        <prfstate>공연중</prfstate>
        <sty>재미있는 공연입니다.</sty>
    </db>
</dbs>
`;

describe('PerformanceCollectorService', () => {
  let service: PerformanceCollectorService;
  let httpService: HttpService;
  let performanceRepo: Repository<Performance>;

  const mockHttpService = {
    get: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'KOPIS_API_KEY') return 'TEST_API_KEY';
      return null;
    }),
  };

  const mockPerformanceRepo = {
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PerformanceCollectorService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: getRepositoryToken(Performance),
          useValue: mockPerformanceRepo,
        },
      ],
    }).compile();

    service = module.get<PerformanceCollectorService>(
      PerformanceCollectorService,
    );
    httpService = module.get<HttpService>(HttpService);
    performanceRepo = module.get<Repository<Performance>>(
      getRepositoryToken(Performance),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('collectAll', () => {
    it('API 호출 후 데이터를 정상적으로 DB에 저장해야 한다', async () => {
      // Given
      mockHttpService.get.mockImplementation((url, config) => {
        // 1. 상세 조회 요청인 경우
        if (url.includes('/PF123456')) {
          return of({ data: MOCK_DETAIL_XML });
        }
        // 2. 목록 조회 요청인 경우
        if (config.params.cpage === 1) {
          return of({ data: MOCK_LIST_XML });
        } else {
          return of({ data: MOCK_EMPTY_XML });
        }
      });

      mockPerformanceRepo.create.mockReturnValue({
        id: 'PF123456',
        title: '테스트 공연',
      } as Performance);

      // When
      await service.collectAll();

      // Then
      expect(httpService.get).toHaveBeenCalled();
      expect(mockPerformanceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'PF123456',
          title: '테스트 공연',
          price: 'R석 50,000원',
          time_info: '화~금 19:30',
        }),
      );
      expect(mockPerformanceRepo.save).toHaveBeenCalled();
    });

    it('API Key가 없으면 로그를 찍고 종료해야 한다', async () => {
      // Given
      jest.spyOn(mockConfigService, 'get').mockReturnValue(null);
      const loggerSpy = jest.spyOn(service['logger'], 'warn');

      // When
      await service.collectAll();

      // Then
      expect(httpService.get).not.toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith('KOPIS API Key 없음');
    });
  });
});
