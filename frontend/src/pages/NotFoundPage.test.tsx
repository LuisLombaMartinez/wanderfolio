import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { NotFoundPage } from './NotFoundPage'

vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header /> }))

function Jump() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/otra/cosa')}>jump</button>
}

function setup(path = '/cualquier/cosa') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Jump />
      <Routes>
        <Route path="/" element={<p>album</p>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('NotFoundPage', () => {
  it('shows the Spanish copy and the 404 line', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Este camino no lleva a ningún sitio' })).toBeInTheDocument()
    expect(screen.getByText('Error 404 · página no encontrada')).toBeInTheDocument()
  })

  it('sets the title and focuses the h1', () => {
    setup()
    expect(document.title).toBe('Nos hemos perdido · Viajecito')
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  })

  it('refocuses the h1 and keeps the title when moving between unknown URLs', async () => {
    setup()
    const heading = screen.getByRole('heading', { level: 1 })
    heading.blur()
    expect(heading).not.toHaveFocus()
    screen.getByText('jump').click()
    await vi.waitFor(() => expect(heading).toHaveFocus())
    expect(document.title).toBe('Nos hemos perdido · Viajecito')
  })

  it('links back to the Album', () => {
    setup()
    expect(screen.getByRole('link', { name: 'Volver al álbum' })).toHaveAttribute('href', '/')
  })
})
