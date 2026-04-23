export interface Transaction {
  id: number;
  "NO": string;
  "KETERANGAN": string;
  "NAMA PESERTA": string;
  "TANGGAL PIUTANG": string;
  "NOMINAL PIUTANG": string;
  "TANGGAL PELUNASAN": string;
  "NOMINAL PELUNASAN": string;
  "SISA PIUTANG": string;
  "STATUS": "BELUM LUNAS" | "LUNAS" | "SEBAGIAN LUNAS";
  "BIAYA ADM": string;
}

export type TransactionStatus = Transaction["STATUS"];
