import nodemailer from 'nodemailer';

export class EmailNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailNotConfiguredError';
  }
}

export interface SendOtpEmailParams {
  to: string;
  name?: string | null;
  otp: string;
  expiresMinutes?: number;
}

/**
 * Mengirim kode OTP reset kata sandi ke Gmail pengguna via SMTP (Nodemailer).
 * Membutuhkan SMTP_USER & SMTP_PASS (Gmail App Password 16 digit) di .env backend.
 */
export async function sendPasswordResetOtpEmail(params: SendOtpEmailParams): Promise<void> {
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(process.env.SMTP_PORT || 465);
  const user = (process.env.SMTP_USER || '').trim();
  const rawPass = (process.env.SMTP_PASS || '').trim();
  const pass = host.toLowerCase().includes('gmail')
    ? rawPass.replace(/\s+/g, '')
    : rawPass;
  const from = (process.env.SMTP_FROM || `BreakFree Coffee <${user}>`).trim();

  if (!user || !pass) {
    throw new EmailNotConfiguredError(
      'Pengiriman email OTP belum dikonfigurasi. Isi SMTP_USER (alamat Gmail) dan SMTP_PASS (App Password Gmail 16 karakter) di file .env backend.'
    );
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });

  const displayName = params.name && params.name.trim().length > 0
    ? params.name.trim()
    : 'Pelanggan BreakFree';
  const expiresMinutes = params.expiresMinutes ?? 15;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #FAF7F2; padding: 24px; border-radius: 16px; border: 1px solid #EBE6DF;">
      <div style="text-align: center; padding-bottom: 16px; border-bottom: 1px solid #EBE6DF;">
        <h2 style="margin: 0; color: #584336;">BreakFree Coffee</h2>
        <p style="margin: 4px 0 0; font-size: 13px; color: #7B6E65;">Verifikasi Reset Kata Sandi</p>
      </div>
      <div style="padding: 20px 8px; color: #2C221E;">
        <p style="margin-top: 0; font-size: 14px;">Halo <strong>${displayName}</strong>,</p>
        <p style="font-size: 14px; line-height: 1.5;">
          Kami menerima permintaan untuk mengatur ulang kata sandi akun BreakFree Hub Anda.
          Masukkan kode OTP 6 digit berikut pada aplikasi:
        </p>
        <div style="margin: 22px 0; text-align: center;">
          <span style="display: inline-block; background: #FFFFFF; border: 2px dashed #6E5545; border-radius: 12px; padding: 14px 28px; font-size: 28px; font-weight: bold; letter-spacing: 8px; color: #584336;">
            ${params.otp}
          </span>
        </div>
        <p style="font-size: 13px; color: #7B6E65; line-height: 1.5;">
          Kode ini hanya berlaku selama <strong>${expiresMinutes} menit</strong>. Demi keamanan akun Anda, jangan bagikan kode ini kepada siapa pun.
        </p>
      </div>
      <div style="text-align: center; font-size: 11px; color: #9E9389; border-top: 1px solid #EBE6DF; padding-top: 12px;">
        Email ini dikirim otomatis oleh sistem BreakFree Coffee. Abaikan jika Anda tidak meminta reset kata sandi.
      </div>
    </div>
  `;

  const text = `Halo ${displayName},\n\nKode OTP reset kata sandi BreakFree Coffee Anda adalah: ${params.otp}\nBerlaku selama ${expiresMinutes} menit. Jangan bagikan kode ini kepada siapa pun.`;

  await transporter.sendMail({
    from,
    to: params.to,
    subject: `[BreakFree Coffee] Kode OTP Reset Kata Sandi: ${params.otp}`,
    text,
    html,
  });
}
