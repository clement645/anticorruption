import { IsString, MinLength } from 'class-validator';

export class UploadSigningKeyDto {
  // The client generates its own Ed25519 keypair and only ever sends the
  // public half, SPKI/PEM-encoded — see SECURITY.md § Digital Signatures for
  // why the private key must never reach this server.
  @IsString()
  @MinLength(1)
  publicKeyPem!: string;
}
