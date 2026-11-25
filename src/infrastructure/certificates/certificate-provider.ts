import "server-only";

/**
 * Porta para certificados digitais ICP-Brasil (A1 em arquivo .pfx/.p12; A3 via token/HSM).
 * Uso previsto: autenticação mTLS em sistemas processuais (PJe, e-SAJ, eproc) e
 * assinatura de peças. A implementação concreta lerá o PFX do bucket privado
 * "certificates" ({org}/{user}/{id}.pfx) e a senha criptografada em
 * digital_certificates.passphrase_enc.
 */
export interface CertificateInfo {
  id: string;
  subjectName: string;
  subjectDocument: string | null; // CPF/CNPJ do titular (OID 2.16.76.1.3.1 / 2.16.76.1.3.3)
  issuer: string;
  serialNumber: string;
  validFrom: Date;
  validUntil: Date;
}

export interface CertificateProvider {
  /** Valida o arquivo e a senha e devolve os metadados (sem persistir a chave em claro). */
  inspect(pfx: Uint8Array, passphrase: string): Promise<CertificateInfo>;
  /** Opções TLS (pfx + passphrase) para um `https.Agent` de cliente com mTLS. */
  tlsOptions(certificateId: string): Promise<{ pfx: Buffer; passphrase: string }>;
  /** Assinatura PKCS#7/CAdES destacada de um documento. */
  sign(certificateId: string, content: Uint8Array): Promise<Uint8Array>;
}

export class NotConfiguredCertificateProvider implements CertificateProvider {
  private error(): never {
    throw new Error("Certificado digital A1 ainda não habilitado nesta instalação.");
  }
  async inspect(): Promise<CertificateInfo> {
    return this.error();
  }
  async tlsOptions(): Promise<{ pfx: Buffer; passphrase: string }> {
    return this.error();
  }
  async sign(): Promise<Uint8Array> {
    return this.error();
  }
}
