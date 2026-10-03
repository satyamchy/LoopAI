import nodemailer from "nodemailer";

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL && process.env.SMTP_FROM);
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const url = process.env.SMTP_URL;
  const from = process.env.SMTP_FROM;
  if (!url || !from) throw new Error("Email is not configured.");
  const transport = nodemailer.createTransport(url);
  await transport.sendMail({ from, to, subject, text });
}
