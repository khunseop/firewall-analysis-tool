import axios from 'axios'

export interface LoginResponse {
  access_token: string
  token_type: string
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const params = new URLSearchParams()
  params.append('username', username)
  params.append('password', password)

  try {
    const res = await axios.post<LoginResponse>('/api/v1/auth/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    return res.data
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const detail = err.response?.data?.detail ?? err.response?.data?.msg ?? err.message
      throw new Error(detail)
    }
    throw err
  }
}
