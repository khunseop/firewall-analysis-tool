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
    <div className="ag-theme-quartz w-full" style={{ height }}>
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
        overlayNoRowsTemplate={`<span class="text-muted-foreground text-sm">${noRowsText}</span>`}
      />
    </div>
  )
}

export const AgGridWrapper = forwardRef(AgGridWrapperInner) as <T>(
  props: AgGridWrapperProps<T> & { ref?: React.ForwardedRef<AgGridWrapperHandle> }
) => React.ReactElement
