import { defineStore } from 'pinia'
import { apiGet, apiPost } from '../api/client'
import {
  generateSigningKeyPair,
  loadSigningKey,
  saveSigningKey,
  buildSignedFields,
} from '../lib/signing'

interface SigningKeyStatus {
  enrolled: boolean
  keyId?: string
  algorithm?: string
  createdAt?: string
}

interface SigningKeyState {
  status: SigningKeyStatus | null
  loading: boolean
  error: string | null
}

export const useSigningKeyStore = defineStore('signingKey', {
  state: (): SigningKeyState => ({
    status: null,
    loading: false,
    error: null,
  }),
  getters: {
    /** True only when THIS browser holds the private half of the currently-enrolled key. */
    canSignHere: (state) => (userId: string | undefined) =>
      Boolean(state.status?.enrolled && userId && loadSigningKey(userId)),
  },
  actions: {
    async fetchStatus() {
      this.loading = true
      this.error = null
      try {
        this.status = await apiGet<SigningKeyStatus>('/users/me/signing-key')
      } catch {
        this.error = 'Unable to load signing key status'
      } finally {
        this.loading = false
      }
    },

    /** Generates a new keypair in-browser, uploads only the public half, and stores the private half locally. */
    async enroll(userId: string) {
      this.loading = true
      this.error = null
      try {
        const { secretKey, publicKeyPem } = generateSigningKeyPair()
        this.status = await apiPost<SigningKeyStatus>('/users/me/signing-key', {
          publicKeyPem,
        })
        saveSigningKey(userId, secretKey)
      } catch {
        this.error = 'Unable to enroll a signing key'
        throw new Error('signing key enrollment failed')
      } finally {
        this.loading = false
      }
    },

    /** Signs one request for a @RequireSignature() endpoint using this browser's locally-held key. */
    signRequest(userId: string, method: string, path: string) {
      const secretKey = loadSigningKey(userId)
      if (!secretKey) {
        throw new Error(
          'No signing key on this device — enroll one before performing this action.',
        )
      }
      return buildSignedFields(secretKey, method, path)
    },
  },
})
