import { useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { AgGridReact } from '@ag-grid-community/react'
import { ModuleRegistry, type ColDef, type GridApi, type GridReadyEvent, type RowClassParams, type RowStyle } from '@ag-grid-community/core'
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
  noRowsText?: string
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
    noRowsText = '데이터가 없습니다.',
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
    gridApiRef.current?.autoSizeAllColumns()
  }, [])

  return (
    <div className="ag-theme-quartz w-full relative" style={{ height }}>
      <AgGridReact<T>
        columnDefs={columnDefs}
        rowData={rowData}
        getRowId={getRowId}
        onGridReady={handleGridReady}
        onFirstDataRendered={handleFirstDataRendered}
        getRowStyle={getRowStyle}
        quickFilterText={quickFilterText}
        defaultColDef={{
          resizable: true,
          filter: true,
          sortable: true,
          filterParams: { buttons: ['reset', 'apply'] },
        }}
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
