import React, { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { motion, AnimatePresence } from "motion/react";
import { Plus, X, Loader2, Wallet, Table as TableIcon, CheckCircle2, Clock, AlertCircle, Search, LogIn, LogOut, Key, Trash2 } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Transaction, TransactionStatus } from "./types";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const queryClient = new QueryClient();

// --- Utilities ---

const parseCurrency = (val: string) => {
  if (!val) return 0;
  return parseInt(val.replace(/[^0-9]/g, "")) || 0;
};

const formatCurrency = (val: number | string) => {
  const num = typeof val === "number" ? val : parseCurrency(val);
  if (!num && num !== 0) return val;
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(num).replace("Rp", "Rp ");
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
};

const parseInputDate = (dateStr: string) => {
  if (!dateStr) return "";
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return dateStr;
  
  const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const parts = dateStr.split(" ");
  if (parts.length === 3) {
    const day = parts[0].padStart(2, "0");
    const monthIndex = months.indexOf(parts[1]);
    const year = parts[2];
    if (monthIndex !== -1) {
      const month = (monthIndex + 1).toString().padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  }
  
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  
  return dateStr;
};

// --- Components ---

type ColumnRole = 'NO' | 'KETERANGAN' | 'NAMA' | 'TGL_PIUTANG' | 'NOM_PIUTANG' | 'TGL_PELUNASAN' | 'NOM_PELUNASAN' | 'SISA' | 'STATUS' | 'ADM' | 'BUKTI_PIUTANG' | 'BUKTI_PELUNASAN';

const detectColumns = (headers: string[]): Record<ColumnRole, string> => {
  const find = (keywords: string[]) => 
    headers.find(h => keywords.every(k => h.toUpperCase().includes(k.toUpperCase()))) || "";

  const roles: Record<string, string> = {};
  
  // Priority detection by keywords
  roles.NO = find(['NO']) || headers.find(h => h.toUpperCase() === 'NO') || "";
  roles.KETERANGAN = find(['KETERANGAN']) || find(['KET']) || "";
  roles.NAMA = find(['NAMA']) || find(['PESERTA']) || "";
  roles.TGL_PIUTANG = find(['TANGGAL', 'PIUTANG']) || find(['TGL', 'PINJAM']) || "";
  roles.NOM_PIUTANG = find(['NOMINAL', 'PIUTANG']) || find(['NOMINAL']) || "";
  roles.TGL_PELUNASAN = find(['TANGGAL', 'PELUNASAN']) || find(['TGL', 'BAYAR']) || "";
  roles.NOM_PELUNASAN = find(['NOMINAL', 'PELUNASAN']) || find(['TOTAL', 'BAYAR']) || "";
  roles.SISA = find(['SISA']) || "";
  roles.STATUS = find(['STATUS']) || "";
  roles.ADM = find(['ADM']) || find(['BIAYA']) || "";
  roles.BUKTI_PIUTANG = find(['BUKTI', 'PIUTANG']) || "";
  roles.BUKTI_PELUNASAN = find(['BUKTI', 'PELUNASAN']) || "";

  // Helper for safe fallbacks to avoid collisions
  const getFallback = (index: number, fallbackName: string) => {
    const fromHeaders = headers[index];
    if (fromHeaders && !Object.values(roles).includes(fromHeaders)) return fromHeaders;
    // Don't fall back to a name that already exists in headers if it belongs to another detected role
    if (headers.includes(fallbackName) && Object.values(roles).includes(fallbackName)) {
        return ""; // Leave empty if collision
    }
    return fallbackName;
  };

  if (!roles.NO) roles.NO = getFallback(0, "NO");
  if (!roles.KETERANGAN) roles.KETERANGAN = getFallback(1, "KETERANGAN");
  if (!roles.NAMA) roles.NAMA = getFallback(2, "NAMA PESERTA");
  if (!roles.TGL_PIUTANG) roles.TGL_PIUTANG = getFallback(3, "TANGGAL PIUTANG");
  if (!roles.NOM_PIUTANG) roles.NOM_PIUTANG = getFallback(4, "NOMINAL PIUTANG");
  if (!roles.TGL_PELUNASAN) roles.TGL_PELUNASAN = getFallback(5, "TANGGAL PELUNASAN");
  if (!roles.NOM_PELUNASAN) roles.NOM_PELUNASAN = getFallback(6, "NOMINAL PELUNASAN");
  if (!roles.SISA) roles.SISA = getFallback(7, "SISA PIUTANG");
  if (!roles.STATUS) roles.STATUS = getFallback(8, "STATUS");
  if (!roles.ADM) roles.ADM = getFallback(9, "BIAYA ADM");
  if (!roles.BUKTI_PIUTANG) roles.BUKTI_PIUTANG = getFallback(10, "BUKTI PIUTANG");
  if (!roles.BUKTI_PELUNASAN) roles.BUKTI_PELUNASAN = getFallback(11, "BUKTI PELUNASAN");

  return roles as Record<ColumnRole, string>;
};

const EditStatusModal = ({ 
  isOpen, 
  onClose, 
  transaction, 
  onSave, 
  isPending,
  mapping
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  transaction: any | null; 
  onSave: (values: string[]) => void;
  isPending: boolean;
  mapping: Record<ColumnRole, string> & { headers: string[] };
}) => {
  const [status, setStatus] = useState<"LUNAS" | "SEBAGIAN LUNAS">("LUNAS");
  const [tanggalPelunasan, setTanggalPelunasan] = useState(new Date().toISOString().split("T")[0]);
  const [nominalPelunasan, setNominalPelunasan] = useState("");
  const [sisaPiutang, setSisaPiutang] = useState("");
  const [bukti, setBukti] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (transaction && mapping) {
      setNominalPelunasan(transaction[mapping.NOM_PELUNASAN] || "");
      setSisaPiutang(transaction[mapping.SISA] || "");
      setTanggalPelunasan(parseInputDate(transaction[mapping.TGL_PELUNASAN]) || new Date().toISOString().split("T")[0]);
      setStatus(transaction[mapping.STATUS] === "SEBAGIAN LUNAS" ? "SEBAGIAN LUNAS" : "LUNAS");
      setBukti(status === "LUNAS" ? transaction[mapping.BUKTI_PELUNASAN] : transaction[mapping.BUKTI_PIUTANG] || "");
    }
  }, [transaction, mapping]);
  
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append("file", file);
    
    setIsUploading(true);
    try {
      const res = await axios.post("/api/upload", formData);
      setBukti(res.data.url);
    } catch (err) {
      alert("Gagal upload file");
    } finally {
      setIsUploading(false);
    }
  };

  // Effect to handle LUNAS logic: sync with piutang
  useEffect(() => {
    if (transaction && status === "LUNAS" && mapping) {
      setNominalPelunasan(transaction[mapping.NOM_PIUTANG]);
      setSisaPiutang("");
      setBukti(transaction[mapping.BUKTI_PELUNASAN] || "");
    } else if (transaction && status === "SEBAGIAN LUNAS" && mapping) {
      setBukti(transaction[mapping.BUKTI_PIUTANG] || "");
    }
  }, [status, transaction, mapping]);

  // Handle sisa piutang auto calculation for Sebagian Lunas
  useEffect(() => {
    if (transaction && status === "SEBAGIAN LUNAS" && mapping) {
      const piutang = parseCurrency(transaction[mapping.NOM_PIUTANG]);
      const pelunasan = parseCurrency(nominalPelunasan);
      const sisa = piutang - pelunasan;
      setSisaPiutang(sisa > 0 ? formatCurrency(sisa) : "0");
    }
  }, [nominalPelunasan, status, transaction, mapping]);

  if (!transaction || !mapping) return null;

  const handleSave = () => {
    const values = mapping.headers.map((header) => {
      if (header === mapping.NO) return transaction[mapping.NO];
      if (header === mapping.KETERANGAN) return transaction[mapping.KETERANGAN];
      if (header === mapping.NAMA) return transaction[mapping.NAMA];
      if (header === mapping.TGL_PIUTANG) return formatDate(transaction[mapping.TGL_PIUTANG]);
      if (header === mapping.NOM_PIUTANG) return transaction[mapping.NOM_PIUTANG];
      if (header === mapping.TGL_PELUNASAN) return formatDate(tanggalPelunasan);
      if (header === mapping.NOM_PELUNASAN) return nominalPelunasan;
      if (header === mapping.SISA) return sisaPiutang;
      if (header === mapping.STATUS) return status;
      if (header === mapping.ADM) return transaction[mapping.ADM];
      if (header === mapping.BUKTI_PIUTANG) return status === "SEBAGIAN LUNAS" ? bukti : transaction[mapping.BUKTI_PIUTANG];
      if (header === mapping.BUKTI_PELUNASAN) return status === "LUNAS" ? bukti : transaction[mapping.BUKTI_PELUNASAN];
      return transaction[header] || "";
    });
    onSave(values);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/10 backdrop-blur-md">
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="w-full max-w-lg"
          >
            <SkeuoCard className="relative p-8 border border-white">
              <button
                onClick={onClose}
                className="absolute top-6 right-6 p-2 rounded-full hover:bg-gray-100 text-gray-400"
              >
                <X size={20} />
              </button>

              <div className="mb-8">
                <h2 className="text-xl font-bold text-gray-800">Update Status Pembayaran</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Peserta: <span className="font-bold text-gray-700">{transaction[mapping.NAMA]}</span>
                </p>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">Ubah Status Ke:</label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => setStatus("LUNAS")}
                      className={cn(
                        "py-3 rounded-xl border-2 font-bold text-sm transition-all",
                        status === "LUNAS" ? "bg-green-50 border-green-500 text-green-700 skeuo-pressed" : "bg-white border-gray-100 text-gray-400 skeuo-flat"
                      )}
                    >
                      LUNAS
                    </button>
                    <button
                      onClick={() => setStatus("SEBAGIAN LUNAS")}
                      className={cn(
                        "py-3 rounded-xl border-2 font-bold text-sm transition-all",
                        status === "SEBAGIAN LUNAS" ? "bg-yellow-50 border-yellow-500 text-yellow-700 skeuo-pressed" : "bg-white border-gray-100 text-gray-400 skeuo-flat"
                      )}
                    >
                      SEBAGIAN LUNAS
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">Tanggal Pelunasan</label>
                    <input 
                      type="date"
                      value={tanggalPelunasan}
                      onChange={(e) => setTanggalPelunasan(e.target.value)}
                      className="skeuo-input text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">
                      {status === "LUNAS" ? "Total Pelunasan" : "Nominal Dicicil"}
                    </label>
                    <input 
                      type="text"
                      value={nominalPelunasan}
                      onChange={(e) => setNominalPelunasan(e.target.value)}
                      className={cn("skeuo-input text-sm", status === "LUNAS" && "bg-gray-50 text-gray-400 cursor-not-allowed")}
                      placeholder="Rp 0"
                      readOnly={status === "LUNAS"}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">Bukti Foto</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="file"
                        accept="image/*"
                        onChange={handleUpload}
                        className="text-sm w-full"
                        disabled={isUploading}
                      />
                      {isUploading && <Loader2 className="animate-spin" size={20} />}
                    </div>
                    {bukti && <a href={bukti} target="_blank" rel="noreferrer" className="text-xs text-blue-500 underline">Lihat Bukti Terupload</a>}
                  </div>
                </div>

                {status === "SEBAGIAN LUNAS" && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="space-y-2"
                  >
                    <label className="text-[10px] font-bold text-gray-500 uppercase ml-1 text-red-500">Sisa Piutang Akhir</label>
                    <input 
                      type="text"
                      value={sisaPiutang}
                      className="skeuo-input text-sm border-red-100 bg-red-50/30 font-bold text-red-600 cursor-not-allowed"
                      placeholder="Rp 0"
                      readOnly
                    />
                  </motion.div>
                )}

                <button
                  disabled={isPending}
                  onClick={handleSave}
                  className="w-full skeuo-button bg-teal-600 text-white flex items-center justify-center gap-2 hover:bg-teal-700 active:bg-teal-800 disabled:opacity-50"
                >
                  {isPending ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
                  <span>Simpan Perubahan</span>
                </button>
              </div>
            </SkeuoCard>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

const SkeuoCard = ({ children, className, pressed = false }: { children: React.ReactNode; className?: string; pressed?: boolean }) => (
  <div className={cn(pressed ? "skeuo-pressed" : "skeuo-flat", "p-6", className)}>
    {children}
  </div>
);

const DeleteConfirmButton = ({ 
  onDelete, 
  isPending, 
  label 
}: { 
  onDelete: () => void; 
  isPending: boolean; 
  label: string;
}) => {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowConfirm(true);
        }}
        disabled={isPending}
        className="p-1.5 rounded-full hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
        title="Hapus Data"
      >
        {isPending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Trash2 size={14} />
        )}
      </button>

      <AnimatePresence>
        {showConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConfirm(false)}
              className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative z-[110] bg-white skeuo-flat p-6 rounded-2xl w-full max-w-[320px] shadow-2xl border border-white"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center text-center gap-4">
                <div className="p-4 bg-red-50 rounded-full text-red-500">
                  <Trash2 size={32} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-800">Hapus Catatan?</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Apakah Anda yakin ingin menghapus data milik <span className="font-bold text-gray-700">{label}</span>? Tindakan ini tidak dapat dibatalkan.
                  </p>
                </div>
                <div className="flex gap-3 w-full mt-2">
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="flex-1 py-3 px-4 rounded-xl border border-gray-100 text-sm font-bold text-gray-400 hover:bg-gray-50 transition-all uppercase tracking-wider"
                  >
                    Batal
                  </button>
                  <button
                    onClick={() => {
                      onDelete();
                      setShowConfirm(false);
                    }}
                    className="flex-1 py-3 px-4 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-all shadow-lg shadow-red-200 uppercase tracking-wider"
                  >
                    Ya, Hapus
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

const FinanceApp = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [mapping, setMapping] = useState<Record<ColumnRole, string> & { headers: string[] } | null>(null);
  const [dynamicForm, setDynamicForm] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  const { data: authStatus } = useQuery({
    queryKey: ["authStatus"],
    queryFn: async () => {
      const res = await axios.get("/api/auth/status");
      return res.data;
    },
  });

  const loginMutation = useMutation({
    mutationFn: async (password: string) => {
      return axios.post("/api/login", { password });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["authStatus"] });
      setIsLoginModalOpen(false);
      setPassword("");
      // Prominent success feedback
      alert("✅ LOGIN BERHASIL!\n\nMode Admin sekarang aktif. Anda sekarang bisa menambah transaksi ke spreadsheet.");
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.error || "Terjadi kesalahan sistem";
      alert("❌ GAGAL LOGIN\n\n" + errorMsg);
    }
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      return axios.post("/api/logout");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["authStatus"] });
    }
  });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(password);
  };

  // Fetch sheet names
  const { data: sheetNames, isLoading: isSheetsLoading } = useQuery<string[]>({
    queryKey: ["sheets"],
    queryFn: async () => {
      const res = await axios.get("/api/sheets");
      if (res.data && res.data.length > 0 && !selectedSheet) {
        setSelectedSheet(res.data[0]);
      }
      return res.data;
    },
  });

  const { data: sheetsData, isLoading, error } = useQuery<{ headers: string[], data: any[] }>({
    queryKey: ["transactions", selectedSheet],
    queryFn: async () => {
      if (!selectedSheet) return { headers: [], data: [] };
      const res = await axios.get(`/api/data?sheet=${encodeURIComponent(selectedSheet)}`);
      const detected = detectColumns(res.data.headers);
      setMapping({ ...detected, headers: res.data.headers });
      return res.data;
    },
    enabled: !!selectedSheet,
  });

  const transactions = sheetsData?.data || [];
  const headers = sheetsData?.headers || [];

  // Group headers for the consolidated detail view
  const financeRoles: ColumnRole[] = ['TGL_PIUTANG', 'NOM_PIUTANG', 'TGL_PELUNASAN', 'NOM_PELUNASAN', 'SISA'];
  const financeHeaders = financeRoles.map(r => mapping?.[r]).filter(Boolean) as string[];

  const mutation = useMutation({
    mutationFn: async (newTransaction: Record<string, string>) => {
      if (!mapping) throw new Error("Mapping not ready");

      // Find the highest existing number in the "NO" column
      const lastNo = transactions?.reduce((max, t) => {
        const num = parseInt(t[mapping.NO]) || 0;
        return num > max ? num : max;
      }, 0) || 0;
      const nextNo = lastNo + 1;
      
      const values = mapping.headers.map((header) => {
        if (header === mapping.NO) return nextNo.toString();
        if (header === mapping.STATUS) return "BELUM LUNAS";
        
        let val = newTransaction[header] || "";

        // If sisa is empty and we have nominal piutang, set sisa = nominal piutang
        if (header === mapping.SISA && !val) {
          val = newTransaction[mapping.NOM_PIUTANG] || "0";
        }
        
        // Auto formatting based on column role/name
        if (header.toUpperCase().includes("TANGGAL") || header.toUpperCase().includes("TGL")) {
          return formatDate(val);
        }
        if (header.toUpperCase().includes("NOMINAL") || header.toUpperCase().includes("BIAYA") || header.toUpperCase().includes("SISA") || header.toUpperCase().includes("RUPIAH") || header.toUpperCase().includes("TOTAL")) {
          const num = parseCurrency(val);
          if (num === 0 && !val) return "";
          return formatCurrency(num);
        }
        
        return val;
      });
      return axios.post(`/api/data?sheet=${encodeURIComponent(selectedSheet)}`, { values });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", selectedSheet] });
      setIsModalOpen(false);
      setDynamicForm({});
    },
    onError: (error: any) => {
      alert("Gagal menyimpan: " + (error.response?.data?.error || error.message));
    }
  });

  const filteredTransactions = transactions?.filter(t => {
    if (!mapping) return true;
    const searchStr = searchTerm.toLowerCase();
    return (
      (t[mapping.KETERANGAN] || "").toLowerCase().includes(searchStr) ||
      (t[mapping.NAMA] || "").toLowerCase().includes(searchStr) ||
      (t[mapping.STATUS] || "").toLowerCase().includes(searchStr)
    );
  }).reverse();

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: number; values: string[] }) => {
      if (!mapping) throw new Error("Mapping not ready");

      // Ensure all monetary columns are formatted
      const formattedValues = values.map((val, idx) => {
        const header = mapping.headers[idx];
        if (header === mapping.TGL_PIUTANG || header === mapping.TGL_PELUNASAN) {
          return formatDate(val);
        }
        if ([mapping.NOM_PIUTANG, mapping.NOM_PELUNASAN, mapping.SISA, mapping.ADM].includes(header)) {
          const num = parseCurrency(val);
          if (num === 0 && !val) return "";
          return formatCurrency(num);
        }
        return val;
      });
      return axios.put(`/api/data/${id}?sheet=${encodeURIComponent(selectedSheet)}`, { values: formattedValues });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", selectedSheet] });
      setIsEditModalOpen(false);
      setEditingTransaction(null);
    },
    onError: (error: any) => {
      alert("Gagal merubah status: " + (error.response?.data?.error || error.message));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return axios.delete(`/api/data/${id}?sheet=${encodeURIComponent(selectedSheet)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", selectedSheet] });
    },
    onError: (error: any) => {
      alert("Gagal menghapus: " + (error.response?.data?.error || error.message));
    }
  });



  const totalPiutang = transactions?.reduce((sum, t) => sum + (mapping ? parseCurrency(t[mapping.NOM_PIUTANG]) : 0), 0) || 0;
  const totalPelunasan = transactions?.reduce((sum, t) => sum + (mapping ? parseCurrency(t[mapping.NOM_PELUNASAN]) : 0), 0) || 0;
  const totalAdm = transactions?.reduce((sum, t) => sum + (mapping ? parseCurrency(t[mapping.ADM]) : 0), 0) || 0;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8">
      {/* Header */}
      <header className="mb-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4 group">
          <div 
            onClick={() => authStatus?.authenticated ? logoutMutation.mutate() : setIsLoginModalOpen(true)}
            className={cn(
              "skeuo-flat p-4 transition-all duration-500 cursor-pointer hover:scale-105 active:scale-95",
              authStatus?.authenticated ? "text-green-600 bg-green-50/50" : "text-teal-600"
            )}
          >
            <Wallet size={32} className={cn(authStatus?.authenticated && "animate-pulse")} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-extrabold tracking-tight text-gray-800">Finance ISOmedik</h1>
              <div className="flex gap-2">
                {authStatus?.authenticated && (
                  <motion.span 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-green-100 text-green-700 text-[10px] font-black px-2 py-0.5 rounded border border-green-200 uppercase tracking-tighter self-center"
                  >
                    Admin Mode
                  </motion.span>
                )}
              </div>
            </div>
            <p className="text-gray-500 font-medium flex items-center gap-2">
              {authStatus?.authenticated ? "Sesi Admin Aktif" : "Pencatatan Piutang Terintegrasi"}
            </p>
          </div>

          <div className="flex gap-4 md:ml-4 flex-wrap">
            <div className="skeuo-flat px-4 py-2 flex flex-col justify-center min-w-[120px]">
              <span className="text-[9px] uppercase font-bold text-gray-400 tracking-tighter">Total Piutang</span>
              <span className="text-sm font-black text-red-600">{formatCurrency(totalPiutang)}</span>
            </div>
            <div className="skeuo-flat px-4 py-2 flex flex-col justify-center min-w-[120px]">
              <span className="text-[9px] uppercase font-bold text-gray-400 tracking-tighter">Total Pelunasan</span>
              <span className="text-sm font-black text-green-600">{formatCurrency(totalPelunasan)}</span>
            </div>
            <div className="skeuo-flat px-4 py-2 flex flex-col justify-center min-w-[120px]">
              <span className="text-[9px] uppercase font-bold text-gray-400 tracking-tighter">Total Biaya ADM</span>
              <span className="text-sm font-black text-teal-600">{formatCurrency(totalAdm)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="text" 
              placeholder="Cari transaksi..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="skeuo-input pl-12"
            />
          </div>

          {authStatus?.authenticated && (
            <button
              onClick={() => { setDynamicForm({}); setIsModalOpen(true); }}
              className="skeuo-button flex items-center justify-center gap-2 text-teal-600 hover:text-teal-700 active:text-teal-800"
            >
              <Plus size={20} />
              <span>Tambah Transaksi</span>
            </button>
          )}
        </div>
      </header>

      {/* Sheet Selection Tabs */}
      {sheetNames && sheetNames.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-4 overflow-x-auto pb-2">
          {sheetNames.map((sheet) => (
            <button
              key={sheet}
              onClick={() => setSelectedSheet(sheet)}
              className={cn(
                "px-6 py-2 rounded-full text-sm font-bold transition-all whitespace-nowrap",
                selectedSheet === sheet 
                  ? "skeuo-pressed text-teal-600" 
                  : "skeuo-flat text-gray-500 hover:text-gray-700"
              )}
            >
              {sheet}
            </button>
          ))}
        </div>
      )}

      {/* Main Content */}
      <main>
        {(isLoading || isSheetsLoading) ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <Loader2 className="animate-spin text-teal-500" size={48} />
            <p className="text-gray-500 font-medium italic">Menghubungkan ke Google Sheets...</p>
          </div>
        ) : error ? (
          <SkeuoCard className="bg-red-50 text-red-600 flex items-start gap-4 border border-red-100 p-6">
            <AlertCircle size={24} className="mt-1 flex-shrink-0" />
            <div>
              <p className="font-bold text-lg">Terjadi Kesalahan</p>
              <p className="mt-2 text-sm leading-relaxed">
                {(error as any)?.response?.data?.error || error.message}
              </p>
              <div className="mt-4 p-3 bg-red-100/50 rounded-lg text-xs font-mono">
                Saran: {(error as any)?.response?.data?.error?.includes("range") ? (
                  <>
                    Periksa variabel <strong>GOOGLE_SHEET_RANGE</strong> di panel Secrets. 
                    Gunakan format seperti <code className="bg-white px-1">Sheet1!A:J</code>. Jangan masukkan angka saja.
                  </>
                ) : (
                  <>
                    Periksa variabel <strong>GOOGLE_SERVICE_ACCOUNT_EMAIL</strong> di panel Secrets. 
                    Pastikan sama persis dengan <code className="bg-white px-1">client_email</code> di file JSON Anda.
                  </>
                )}
              </div>
            </div>
          </SkeuoCard>
        ) : (
          <div className="space-y-8">
            <SkeuoCard className="overflow-x-auto p-0 border border-white/40">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-300">
                    {(() => {
                      let detailHeaderRendered = false;
                      return headers.map((header) => {
                        const isFinance = financeHeaders.includes(header);
                        if (isFinance) {
                          if (!detailHeaderRendered) {
                            detailHeaderRendered = true;
                            return (
                              <th key="consolidated-header" className="p-4 font-bold text-[10px] uppercase tracking-wider text-gray-500 border-r border-gray-200 whitespace-nowrap w-[250px]">
                                Detail Piutang / Pelunasan
                              </th>
                            );
                          }
                          return null;
                        }

                        return (
                          <th 
                            key={header} 
                            className={cn(
                              "p-4 font-bold text-[10px] uppercase tracking-wider text-gray-500 border-r border-gray-200 whitespace-nowrap",
                              header === mapping?.NO && "w-12 text-center",
                            )}
                          >
                            {header}
                          </th>
                        );
                      }).filter(Boolean);
                    })()}
                    {authStatus?.authenticated && (
                      <th className="p-4 font-bold text-[10px] uppercase tracking-wider text-gray-500 w-12 text-center">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions?.length === 0 ? (
                    <tr>
                      {/* Dynamic colSpan calculation */}
                      {(() => {
                        const uniqueRenderedCols = headers.filter(h => !financeHeaders.includes(h)).length + (financeHeaders.length > 0 ? 1 : 0) + (authStatus?.authenticated ? 1 : 0);
                        return (
                          <td colSpan={uniqueRenderedCols} className="p-12 text-center text-gray-400 italic font-medium">
                            {searchTerm ? `Tidak ada hasil untuk "${searchTerm}"` : "Belum ada data piutang."}
                          </td>
                        );
                      })()}
                    </tr>
                  ) : (
                    filteredTransactions?.map((t) => (
                      <tr key={t.id} className="border-b border-gray-300 hover:bg-gray-50/50 transition-colors">
                        {(() => {
                          let detailCellRendered = false;
                          return headers.map((header) => {
                            const val = t[header];
                            const role = Object.entries(mapping || {}).find(([_, label]) => label === header)?.[0] as ColumnRole;
                            
                            // Consolidated logic for Finance roles
                            if (financeHeaders.includes(header)) {
                              if (!detailCellRendered && mapping) {
                                detailCellRendered = true;
                                return (
                                  <td key="consolidated-cell" className="p-4 text-sm border-r border-gray-300 min-w-[200px]">
                                    <AnimatePresence mode="wait">
                                      {t[mapping.STATUS] === "BELUM LUNAS" && (
                                        <motion.div key="belum-lunas" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="flex flex-col gap-1">
                                          <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Data Piutang:</span>
                                          <div className="flex items-center justify-between">
                                            <span className="font-bold text-gray-700">{formatCurrency(t[mapping.NOM_PIUTANG])}</span>
                                            <span className="text-[10px] text-gray-900 font-mono">{formatDate(t[mapping.TGL_PIUTANG])}</span>
                                          </div>
                                          {t[mapping.BUKTI_PIUTANG] && <a href={t[mapping.BUKTI_PIUTANG]} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 underline mt-1">Lihat Bukti Piutang</a>}
                                        </motion.div>
                                      )}
                                      {t[mapping.STATUS] === "LUNAS" && (
                                        <motion.div key="lunas" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="flex flex-col gap-1">
                                          <span className="text-[10px] text-green-600 uppercase font-bold tracking-wider">Data Pelunasan:</span>
                                          <div className="flex items-center justify-between">
                                            <span className="font-bold text-green-600">{formatCurrency(t[mapping.NOM_PELUNASAN])}</span>
                                            <span className="text-[10px] text-gray-900 font-mono">{formatDate(t[mapping.TGL_PELUNASAN])}</span>
                                          </div>
                                          {t[mapping.BUKTI_PELUNASAN] && <a href={t[mapping.BUKTI_PELUNASAN]} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 underline mt-1">Lihat Bukti Pelunasan</a>}
                                        </motion.div>
                                      )}
                                      {t[mapping.STATUS] === "SEBAGIAN LUNAS" && (
                                        <motion.div key="sebagian" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="flex flex-col gap-2">
                                          <div className="flex flex-col gap-1">
                                            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Data Piutang:</span>
                                            <div className="flex items-center justify-between">
                                              <span className="font-medium text-gray-600">{formatCurrency(t[mapping.NOM_PIUTANG])}</span>
                                              <span className="text-[10px] text-gray-900 font-mono">{formatDate(t[mapping.TGL_PIUTANG])}</span>
                                            </div>
                                            {t[mapping.BUKTI_PIUTANG] && <a href={t[mapping.BUKTI_PIUTANG]} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 underline mt-1">Lihat Bukti Piutang</a>}
                                          </div>
                                          <div className="flex items-center justify-between border-t border-gray-100 pt-1">
                                            <span className="text-[10px] text-yellow-600 uppercase font-bold">Sisa:</span>
                                            <span className="font-bold text-yellow-600">{formatCurrency(t[mapping.SISA])}</span>
                                          </div>
                                          {t[mapping.BUKTI_PELUNASAN] && <a href={t[mapping.BUKTI_PELUNASAN]} target="_blank" rel="noreferrer" className="text-[10px] text-blue-500 underline mt-1">Lihat Bukti Pelunasan</a>}
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </td>
                                );
                              }
                              return null;
                            }

                            // Rendering for all other headers (dynamic styling)
                            if (role === 'STATUS') {
                              return (
                                <td key={header} className="p-4 border-r border-gray-300">
                                  <div 
                                    onClick={() => {
                                      if (mapping && authStatus?.authenticated && t[mapping.STATUS] !== "LUNAS") {
                                        setEditingTransaction(t);
                                        setIsEditModalOpen(true);
                                      }
                                    }}
                                    className={cn(
                                      "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all",
                                      mapping && authStatus?.authenticated && t[mapping.STATUS] !== "LUNAS" ? "cursor-pointer hover:scale-105 active:scale-95" : "",
                                      val === "LUNAS" ? "bg-green-100 text-green-700 shadow-sm" :
                                      val === "SEBAGIAN LUNAS" ? "bg-yellow-100 text-yellow-700 shadow-sm" :
                                      "bg-red-100 text-red-700 shadow-sm"
                                    )}
                                  >
                                    {val === "LUNAS" ? <CheckCircle2 size={12} /> : val === "SEBAGIAN LUNAS" ? <AlertCircle size={12} /> : <Clock size={12} />}
                                    {val}
                                  </div>
                                </td>
                              );
                            }

                            const isAmount = role === 'ADM' || header.toUpperCase().includes("RP") || header.toUpperCase().includes("NOMINAL") || header.toUpperCase().includes("BIAYA");
                            const isDate = header.toUpperCase().includes("TANGGAL") || header.toUpperCase().includes("TGL");

                            if (isAmount) {
                              return (
                                <td key={header} className={cn("p-4 text-sm font-bold border-r border-gray-300 whitespace-nowrap", role === 'ADM' ? "text-gray-400 italic" : "text-gray-700")}>
                                  {formatCurrency(val)}
                                </td>
                              );
                            }

                            if (isDate) {
                              return (
                                <td key={header} className="p-4 text-[10px] font-mono text-gray-900 border-r border-gray-300 whitespace-nowrap">
                                  {formatDate(val)}
                                </td>
                              );
                            }

                            return (
                              <td key={header} className={cn("p-4 text-sm border-r border-gray-300", header === mapping?.NO && "text-center font-mono")}>
                                {val}
                              </td>
                            );
                          }).filter(Boolean);
                        })()}
                        
                        {authStatus?.authenticated && (
                          <td className="p-4 text-center">
                            <DeleteConfirmButton 
                              label={mapping ? t[mapping.NAMA] : "Transaksi"}
                              isPending={deleteMutation.isPending && deleteMutation.variables === t.id}
                              onDelete={() => deleteMutation.mutate(t.id)}
                            />
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </SkeuoCard>
          </div>
        )}
      </main>

      {/* Modal / Form */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/5 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-2xl"
            >
              <SkeuoCard className="relative p-8 max-h-[90vh] overflow-y-auto">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="absolute top-6 right-6 p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X size={24} />
                </button>

                <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">
                  <TableIcon className="text-teal-600" />
                  Tambah Catatan Baru
                </h2>

                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    mutation.mutate(dynamicForm);
                  }} 
                  className="space-y-6"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {headers.filter(h => {
                       if (!mapping) return true;
                       const headerUpper = h.toUpperCase();
                       // Hide NO, STATUS, and Repayment fields for new entries
                       return h !== mapping.NO && 
                              h !== mapping.STATUS && 
                              h !== mapping.TGL_PELUNASAN && 
                              h !== mapping.NOM_PELUNASAN &&
                              h !== mapping.SISA &&
                              h !== mapping.BUKTI_PELUNASAN;
                    }).map((header) => {
                      const isDate = header.toUpperCase().includes("TANGGAL") || header.toUpperCase().includes("TGL");
                      
                      if (mapping && (header === mapping.BUKTI_PIUTANG || header === mapping.BUKTI_PELUNASAN)) {
                        return (
                          <div key={header} className="space-y-2">
                            <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">{header}</label>
                            <input 
                              type="file" 
                              accept="image/*"
                              onChange={async (e) => {
                                if (e.target.files && e.target.files[0]) {
                                  const formData = new FormData();
                                  formData.append("file", e.target.files[0]);
                                  try {
                                    const res = await axios.post("/api/upload", formData);
                                    setDynamicForm(prev => ({ ...prev, [header]: res.data.url }));
                                  } catch (err) { alert("Gagal upload"); }
                                }
                              }}
                              className="skeuo-input" 
                            />
                            {dynamicForm[header] && <a href={dynamicForm[header]} target="_blank" rel="noreferrer" className="text-xs text-blue-500">Bukti Terupload</a>}
                          </div>
                        );
                      }
                      
                      return (
                        <div key={header} className="space-y-2">
                          <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">{header}</label>
                          <input 
                            type={isDate ? "date" : "text"} 
                            value={dynamicForm[header] || ""} 
                            onChange={(e) => setDynamicForm(prev => ({ ...prev, [header]: e.target.value }))}
                            className="skeuo-input" 
                            placeholder={header}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-6">
                    <button
                      disabled={mutation.isPending}
                      type="submit"
                      className="w-full skeuo-button bg-teal-600 text-white flex items-center justify-center gap-2 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed group transition-all"
                    >
                      {mutation.isPending ? (
                        <Loader2 className="animate-spin" size={20} />
                      ) : (
                        <Plus size={20} className="group-hover:scale-110 transition-transform" />
                      )}
                      <span>Tambah Transaksi Baru</span>
                    </button>
                  </div>
                </form>
              </SkeuoCard>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Status Modal */}
      <EditStatusModal 
        isOpen={isEditModalOpen} 
        onClose={() => { setIsEditModalOpen(false); setEditingTransaction(null); }}
        transaction={editingTransaction}
        onSave={(updatedValues) => {
          if (editingTransaction) {
            updateMutation.mutate({ id: editingTransaction.id, values: updatedValues });
          }
        }}
        isPending={updateMutation.isPending}
        mapping={mapping!}
      />

      {/* Login Modal */}
      <AnimatePresence>
        {isLoginModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/5 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm"
            >
              <SkeuoCard className="relative p-8">
                <button
                  onClick={() => setIsLoginModalOpen(false)}
                  className="absolute top-6 right-6 p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X size={20} />
                </button>

                <div className="text-center mb-8">
                  <div className="skeuo-flat w-16 h-16 flex items-center justify-center mx-auto mb-4 text-teal-600">
                    <Key size={32} />
                  </div>
                  <h2 className="text-xl font-bold text-gray-800">Login Admin</h2>
                  <p className="text-xs text-gray-400 mt-1">Hanya admin yang dapat menambah data</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase ml-1">Password</label>
                    <input 
                      type="password" 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="skeuo-input text-center tracking-widest"
                      placeholder="••••••••"
                      autoFocus
                    />
                  </div>

                  <button
                    disabled={loginMutation.isPending}
                    type="submit"
                    className="w-full skeuo-button bg-teal-600 text-white flex items-center justify-center gap-2 hover:bg-teal-700 disabled:opacity-50"
                  >
                    {loginMutation.isPending ? <Loader2 className="animate-spin" size={20} /> : <LogIn size={20} />}
                    <span>Masuk</span>
                  </button>
                </form>
              </SkeuoCard>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      <footer className="mt-12 text-center text-gray-400 text-xs">
        <p>© 2026 SkeuoFinance - Integrated with Google Sheets API</p>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <FinanceApp />
    </QueryClientProvider>
  );
}
