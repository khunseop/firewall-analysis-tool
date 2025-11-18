"""
워크플로우 상태 관리
"""
import logging
from typing import Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.models.deletion_workflow import DeletionWorkflow
from app.services.deletion_workflow.config_manager import ConfigManager
from app.services.deletion_workflow.file_manager import FileManager
from app.services.deletion_workflow.excel_manager import ExcelManager
from app.services.deletion_workflow.processors.request_parser import RequestParser
from app.services.deletion_workflow.processors.request_extractor import RequestExtractor
from app.services.deletion_workflow.processors.mis_id_adder import MisIdAdder
from app.services.deletion_workflow.processors.application_aggregator import ApplicationAggregator
from app.services.deletion_workflow.processors.request_info_adder import RequestInfoAdder
from app.services.deletion_workflow.processors.exception_handler import ExceptionHandler
from app.services.deletion_workflow.processors.duplicate_policy_classifier import DuplicatePolicyClassifier
from app.services.deletion_workflow.final_exporter import FinalExporter

logger = logging.getLogger(__name__)


class WorkflowManager:
    """워크플로우 관리자"""
    
    def __init__(self, db: AsyncSession, device_id: int):
        """
        WorkflowManager 초기화
        
        Args:
            db: 데이터베이스 세션
            device_id: 장비 ID
        """
        self.db = db
        self.device_id = device_id
        self.config = ConfigManager()
        self.file_manager = FileManager()
        self.excel_manager = ExcelManager(self.config.all())
    
    async def get_or_create_workflow(self) -> DeletionWorkflow:
        """워크플로우 조회 또는 생성"""
        workflow = await crud.deletion_workflow.get_workflow_by_device(self.db, self.device_id)
        if not workflow:
            workflow = await crud.deletion_workflow.create_workflow(self.db, self.device_id)
        return workflow
    
    async def execute_step(self, step_number: int, **kwargs) -> Dict[str, Any]:
        """
        특정 단계 실행
        
        Args:
            step_number: 단계 번호 (1-7)
            **kwargs: 단계별 추가 인자
            
        Returns:
            실행 결과 딕셔너리
        """
        workflow = await self.get_or_create_workflow()
        
        try:
            await crud.deletion_workflow.update_workflow(
                self.db, workflow, status="in_progress", current_step=step_number
            )
            
            result = {}
            
            if step_number == 1:
                # Step 1: RequestParser
                parser = RequestParser(
                    self.db, self.device_id, self.config, self.file_manager, self.excel_manager
                )
                file_path = await parser.parse_policies()
                result['file_path'] = file_path
                
                # 마스터 파일 경로 업데이트
                step_files = workflow.step_files or {}
                step_files['1'] = file_path
                await crud.deletion_workflow.update_workflow(
                    self.db, workflow, master_file_path=file_path, step_files=step_files
                )
            
            elif step_number == 2:
                # Step 2: RequestExtractor
                step1_file = workflow.step_files.get('1') or workflow.master_file_path
                if not step1_file:
                    raise ValueError("Step 1을 먼저 실행해야 합니다.")
                
                extractor = RequestExtractor(
                    self.device_id, self.config, self.file_manager, self.excel_manager
                )
                file_path = extractor.extract_request_ids(step1_file)
                result['file_path'] = file_path
                
                step_files = workflow.step_files or {}
                step_files['2'] = file_path
                await crud.deletion_workflow.update_workflow(
                    self.db, workflow, step_files=step_files
                )
            
            elif step_number == 3:
                # Step 3: MisIdAdder
                master_file = workflow.master_file_path or workflow.step_files.get('1')
                csv_file = kwargs.get('csv_file_path')
                if not master_file or not csv_file:
                    raise ValueError("마스터 파일과 CSV 파일이 필요합니다.")
                
                adder = MisIdAdder(
                    self.device_id, self.config, self.file_manager, self.excel_manager
                )
                file_path = adder.update_mis_id(master_file, csv_file)
                result['file_path'] = file_path
                
                step_files = workflow.step_files or {}
                step_files['3'] = file_path
                await crud.deletion_workflow.update_workflow(
                    self.db, workflow, master_file_path=file_path, step_files=step_files
                )
            
            elif step_number == 4:
                # Step 4: ApplicationAggregator
                input_file = kwargs.get('input_file_path')
                if not input_file:
                    raise ValueError("입력 파일이 필요합니다.")
                
                aggregator = ApplicationAggregator(
                    self.device_id, self.config, self.file_manager, self.excel_manager
                )
                file_path = aggregator.process_applications(input_file)
                result['file_path'] = file_path
                
                step_files = workflow.step_files or {}
                step_files['4'] = file_path
                await crud.deletion_workflow.update_workflow(
                    self.db, workflow, step_files=step_files
                )
            
            elif step_number == 5:
                # Step 5: RequestInfoAdder
                master_file = workflow.master_file_path or workflow.step_files.get('3') or workflow.step_files.get('1')
                info_file = workflow.step_files.get('4') or kwargs.get('info_file_path')
                if not master_file or not info_file:
                    raise ValueError("마스터 파일과 신청정보 파일이 필요합니다.")
                
                adder = RequestInfoAdder(
                    self.device_id, self.config, self.file_manager, self.excel_manager
                )
                file_path = adder.add_request_info(master_file, info_file)
                result['file_path'] = file_path
                
                step_files = workflow.step_files or {}
                step_files['5'] = file_path
                await crud.deletion_workflow.update_workflow(
                    self.db, workflow, master_file_path=file_path, step_files=step_files
                )
            
            elif step_number == 6:
                # Step 6: ExceptionHandler
                master_file = workflow.master_file_path or workflow.step_files.get('5')
                vendor = kwargs.get('vendor', 'paloalto')
                if not master_file:
                    raise ValueError("마스터 파일이 필요합니다.")
                
                handler = ExceptionHandler(
                    self.device_id, self.config, self.file_manager, self.excel_manager
                )
                file_path = handler.classify_exceptions(master_file, vendor)
                result['file_path'] = file_path
                
                step_files = workflow.step_files or {}
                step_files['6'] = file_path
                await crud.deletion_workflow.update_workflow(
                    self.db, workflow, master_file_path=file_path, step_files=step_files
                )
            
            elif step_number == 7:
                # Step 7: DuplicatePolicyClassifier
                master_file = workflow.master_file_path or workflow.step_files.get('6')
                redundancy_file = kwargs.get('redundancy_result_file_path')
                info_file = workflow.step_files.get('4')
                if not master_file or not redundancy_file or not info_file:
                    raise ValueError("마스터 파일, 중복정책 분석 결과 파일, 신청정보 파일이 필요합니다.")
                
                classifier = DuplicatePolicyClassifier(
                    self.device_id, self.config, self.file_manager, self.excel_manager
                )
                notice_path, delete_path = classifier.classify_duplicates(
                    master_file, redundancy_file, info_file
                )
                result['notice_file_path'] = notice_path
                result['delete_file_path'] = delete_path
                
                step_files = workflow.step_files or {}
                step_files['7_notice'] = notice_path
                step_files['7_delete'] = delete_path
                await crud.deletion_workflow.update_workflow(
                    self.db, workflow, step_files=step_files
                )
            
            else:
                raise ValueError(f"잘못된 단계 번호: {step_number}")
            
            await crud.deletion_workflow.update_workflow(
                self.db, workflow, status="completed"
            )
            
            return result
            
        except Exception as e:
            logger.error(f"Step {step_number} 실행 실패: {e}", exc_info=True)
            await crud.deletion_workflow.update_workflow(
                self.db, workflow, status="failed"
            )
            raise
    
    async def export_final_results(self) -> Dict[str, str]:
        """최종 결과 파일들 생성"""
        workflow = await self.get_or_create_workflow()
        master_file = workflow.master_file_path or workflow.step_files.get('6')
        
        if not master_file:
            raise ValueError("Step 6을 먼저 실행해야 합니다.")
        
        exporter = FinalExporter(
            self.device_id, self.config, self.file_manager, self.excel_manager
        )
        result_files = exporter.export_final_results(master_file)
        
        # 중복정책 파일 추가
        if '7_notice' in workflow.step_files:
            result_files['duplicate_notice'] = workflow.step_files['7_notice']
        if '7_delete' in workflow.step_files:
            result_files['duplicate_delete'] = workflow.step_files['7_delete']
        
        await crud.deletion_workflow.update_workflow(
            self.db, workflow, final_files=result_files
        )
        
        return result_files

