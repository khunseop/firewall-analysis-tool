import { useRef, useCallback, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react'
import { AgGridReact } from '@ag-grid-community/react'
import {
  ModuleRegistry,
  type ColDef, type GridApi, type GridReadyEvent,
  type RowClassParams, type RowStyle, type RowClickedEvent,
  type GridSizeChangedEvent, type IRowNode,
} from '@ag-grid-community/core'
import { ClientSideRowModelModule } from '@ag-grid-community/client-side-row-model'
import { CsvExportModule } from '@ag-grid-community/csv-export'

import '@ag-grid-community/styles/ag-grid.css'
import '@ag-grid-community/styles/ag-theme-quartz.css'

ModuleRegistry.registerModules([ClientSideRowModelModule, CsvExportModule])

export interface AgGridWrapperHandle {
  gridApi: GridApi | null
}

interface AgGridWrapperProps<T> {
  columnDefs: ColDef<T>[]
  rowData: T[]
  getRowId?: (params: { data: T }) => string
  onGridReady?: (params: GridReadyEvent<T>) => void
  getRowStyle?: (params: RowClassParams<T>) => RowStyle | undefined
  quickFilterText?: string
  height?: string | number
  domLayout?: 'normal' | 'autoHeight' | 'print'
  noRowsText?: string
  defaultColDefOverride?: Record<string, unknown>
  onRowClicked?: (event: RowClickedEvent<T>) => void
  /** 컬럼을 컨테이너 너비에 맞게 분배 (기본값: false = 내용 기반 자동 너비) */
  fitColumns?: boolean
  rowHeight?: number
  rowSelection?: 'single' | 'multiple' | {
    mode: 'singleRow' | 'multiRow'
    checkboxes?: boolean
    headerCheckbox?: boolean
    checkboxesFilteredOnly?: boolean
    enableClickSelection?: boolean
  }
  onSelectionChanged?: (rows: T[]) => void
  context?: Record<string, unknown>
  isExternalFilterPresent?: () => boolean
  doesExternalFilterPass?: (node: IRowNode<T>) => boolean
}

function AgGridWrapperInner<T>(
  {
    columnDefs,
    rowData,
    getRowId,
    onGridReady,
    getRowStyle,
    quickFilterText,
    height = 'calc(100vh - 200px)',
    domLayout,
    noRowsText = '데이터가 없습니다.',
    defaultColDefOverride,
    onRowClicked,
    fitColumns = false,
    rowHeight,
    rowSelection,
    onSelectionChanged,
    context,
    isExternalFilterPresent,
    doesExternalFilterPass,
  }: AgGridWrapperProps<T>,
  ref: React.ForwardedRef<AgGridWrapperHandle>
) {
  const gridApiRef = useRef<GridApi<T> | null>(null)

  useImperativeHandle(ref, () => ({
    get gridApi() {
      return gridApiRef.current
    },
  }))

  const handleGridReady = useCallback(
    (params: GridReadyEvent<T>) => {
      gridApiRef.current = params.api
      onGridReady?.(params)
    },
    [onGridReady]
  )

  const handleFirstDataRendered = useCallback(() => {
    if (fitColumns) {
      gridApiRef.current?.sizeColumnsToFit()
    } else {
      gridApiRef.current?.autoSizeAllColumns(false)
    }
  }, [fitColumns])

  // rowData가 실제로 교체될 때(새 검색 결과)만 autoSize — 타이핑·필터링 시 불필요한 리사이즈 방지
  useEffect(() => {
    if (rowData.length === 0) return
    const id = requestAnimationFrame(() => {
      if (fitColumns) {
        gridApiRef.current?.sizeColumnsToFit()
      } else {
        gridApiRef.current?.autoSizeAllColumns(false)
      }
    })
    return () => cancelAnimationFrame(id)
  }, [rowData]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleGridSizeChanged = useCallback((_e: GridSizeChangedEvent) => {
    if (fitColumns) {
      gridApiRef.current?.sizeColumnsToFit()
    }
  }, [fitColumns])

  const defaultColDef = useMemo(() => ({
    resizable: true,
    filter: true,
    sortable: true,
    filterParams: { buttons: ['reset', 'apply'] },
    ...defaultColDefOverride,
  }), [defaultColDefOverride])

  const containerClass = `ag-theme-quartz w-full relative${onRowClicked ? ' ag-clickable-rows' : ''}`
  const isFill = height === '100%'
  const isAutoHeight = domLayout === 'autoHeight'

  return (
    <div
      className={isFill ? `${containerClass} flex-1 min-h-0` : containerClass}
      style={isFill || isAutoHeight ? undefined : { height }}
    >
      <AgGridReact<T>
        domLayout={domLayout}
        columnDefs={columnDefs}
        rowData={rowData}
        getRowId={getRowId}
        rowHeight={rowHeight}
        onGridReady={handleGridReady}
        onFirstDataRendered={handleFirstDataRendered}
        onGridSizeChanged={handleGridSizeChanged}
        getRowStyle={getRowStyle}
        quickFilterText={quickFilterText}
        onRowClicked={onRowClicked}
        rowSelection={rowSelection}
        onSelectionChanged={onSelectionChanged ? (e) => onSelectionChanged(e.api.getSelectedRows()) : undefined}
        context={context}
        isExternalFilterPresent={isExternalFilterPresent}
        doesExternalFilterPass={doesExternalFilterPass}
        defaultColDef={defaultColDef}
        enableCellTextSelection
        overlayNoRowsTemplate={`
          <div class="flex flex-col items-center gap-3">
            <div class="p-3 bg-ds-surface-container rounded-full">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-ds-on-surface-variant/60"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
            </div>
            <span class="text-ds-on-surface-variant font-medium text-sm">${noRowsText}</span>
          </div>
        `}
        overlayLoadingTemplate={`
          <div class="flex flex-col items-center gap-3">
            <svg class="animate-spin h-8 w-8 text-ds-tertiary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="text-ds-on-surface-variant font-semibold text-sm">데이터 분석 중…</span>
          </div>
        `}
      />
    </div>
  )
}

export const AgGridWrapper = forwardRef(AgGridWrapperInner) as <T>(
  props: AgGridWrapperProps<T> & { ref?: React.ForwardedRef<AgGridWrapperHandle> }
) => React.ReactElement
