import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface User {
    id: string;
    email: string;
    role: string;
    name?: string | null;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      role: string;
      name?: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: string;
  }
}
