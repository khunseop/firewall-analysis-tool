import logging
import pandas as pd
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from io import BytesIO
from urllib.parse import quote
from openpyxl.styles import Font, PatternFill, Alignment

router = APIRouter()


@router.post("/export/excel")
async def export_to_excel(data: dict):
    """Export grid data to Excel file using pandas DataFrame."""
    try:
        rows = data.get("data", [])
        filename = data.get("filename", "export")
        if not rows:
            raise HTTPException(status_code=400, detail="No data to export")
        df = pd.DataFrame(rows)
        output = BytesIO()
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="Sheet1")
            ws = writer.sheets["Sheet1"]

            header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
            header_font = Font(bold=True, color="FFFFFF", size=11)
            header_align = Alignment(horizontal="center", vertical="center")
            for cell in ws[1]:
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = header_align
            ws.row_dimensions[1].height = 20

            for col in ws.columns:
                max_len = max((len(str(cell.value or '')) for cell in col), default=8)
                ws.column_dimensions[col[0].column_letter].width = min(max_len + 2, 40)

        output.seek(0)
        encoded_name = quote(f"{filename}.xlsx", safe='')
        headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}"}
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers=headers,
        )
    except Exception as e:
        logging.error(f"Failed to export Excel: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to export Excel: {str(e)}")
