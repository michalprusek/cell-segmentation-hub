// Lazy-loaded service for Excel export functionality to reduce initial bundle size
export const createExcelExport = async () => {
  // Dynamically import ExcelJS only when needed
  const ExcelJS = (await import('exceljs')).default;

  return {
    createWorkbook: () => new ExcelJS.Workbook(),

    async writeBuffer(workbook: any) {
      return await workbook.xlsx.writeBuffer();
    },

    createBlob(buffer: ArrayBuffer) {
      return new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    },

    downloadFile(blob: Blob, filename: string) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    },
  };
};

export type ExcelExportService = Awaited<ReturnType<typeof createExcelExport>>;
