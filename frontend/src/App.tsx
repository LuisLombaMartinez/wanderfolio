import { Route, Routes } from 'react-router'
import { AuthProvider } from '@/auth/AuthProvider'
import { RequireMember } from '@/auth/RequireMember'
import { UploadBar } from '@/components/UploadBar'
import { AuroraBackground } from '@/components/AuroraBackground'
import { AlbumPage } from '@/pages/AlbumPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { TripFormPage } from '@/pages/TripFormPage'
import { TripPage } from '@/pages/TripPage'

export default function App() {
  return (
    <AuthProvider>
      <AuroraBackground />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireMember>
              <AlbumPage />
            </RequireMember>
          }
        />
        <Route path="/trips/new" element={<RequireMember><TripFormPage /></RequireMember>} />
        <Route path="/trips/:id" element={<RequireMember><TripPage /></RequireMember>} />
        <Route path="/trips/:id/edit" element={<RequireMember><TripFormPage /></RequireMember>} />
        {/* Unknown routes need a Member too; Members see the 404 at the typed URL. */}
        <Route path="*" element={<RequireMember><NotFoundPage /></RequireMember>} />
      </Routes>
      <UploadBar />
    </AuthProvider>
  )
}
