import { Request, Response } from 'express';
import {
  getActiveShiftRecord,
  startShiftService,
  closeShiftService,
  getShiftHistoryService,
  getActiveShiftSummaryService,
} from '../services/shift.service';

export const startShift = async (req: Request, res: Response): Promise<any> => {
  const { cashierName, shiftStatus, startingCash } = req.body;

  try {
    const result = await startShiftService(cashierName, shiftStatus, Number(startingCash) || 0);
    return res.status(201).json({
      message: 'Shift berhasil dimulai!',
      shiftId: result.shiftId,
      cashierName: result.cashierName,
      startingCash: result.startingCash,
    });
  } catch (error) {
    console.error('Gagal menyimpan shift:', error);
    return res.status(500).json({ message: 'Gagal menyimpan data shift' });
  }
};

export const getActiveShift = async (_req: Request, res: Response): Promise<any> => {
  try {
    const activeShift = await getActiveShiftRecord();
    if (!activeShift) {
      return res.status(200).json({ active: false, message: 'Belum ada shift' });
    }

    return res.status(200).json({
      active: true,
      shift: activeShift,
    });
  } catch (error) {
    console.error('Gagal mengambil shift:', error);
    return res.status(500).json({ message: 'Gagal mengambil data shift' });
  }
};

export const closeShift = async (req: Request, res: Response): Promise<any> => {
  const { shiftId } = req.body;

  try {
    const summary = await closeShiftService(Number(shiftId));
    if (!summary) {
      return res.status(404).json({ message: 'Shift tidak ditemukan' });
    }

    return res.status(200).json({
      message: 'Shift berhasil ditutup',
      summary,
    });
  } catch (error) {
    console.error('Gagal menutup shift:', error);
    return res.status(500).json({ message: 'Gagal menutup shift' });
  }
};

export const getShiftHistory = async (_req: Request, res: Response): Promise<any> => {
  try {
    const history = await getShiftHistoryService();
    return res.status(200).json(history);
  } catch (error) {
    console.error('Gagal mengambil riwayat shift:', error);
    return res.status(500).json({ message: 'Gagal mengambil riwayat' });
  }
};

export const getShiftSummary = async (_req: Request, res: Response): Promise<any> => {
  try {
    const summary = await getActiveShiftSummaryService();
    if (!summary) {
      return res.status(200).json({ active: false, message: 'Tidak ada shift aktif' });
    }

    return res.status(200).json(summary);
  } catch (error) {
    console.error('Gagal mengambil rekap shift:', error);
    return res.status(500).json({ message: 'Gagal menghitung rekap shift' });
  }
};
