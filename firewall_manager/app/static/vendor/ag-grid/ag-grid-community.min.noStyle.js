// Placeholder shim for AG Grid API shape used by this app.
// Replace with official ag-grid-community.min.noStyle.js offline package.
window.agGrid = window.agGrid || {};
agGrid.Grid = function(e, opts){
  e.__grid_opts = opts;
  e.__grid_api = {
    setGridOption: function(k,v){ e.__grid_opts[k]=v; },
    setRowData: function(rows){ e.__row_data = rows; },
    getSelectedRows: function(){ return []; },
    refreshCells: function(){}
  };
  e.api = e.__grid_api;
};

