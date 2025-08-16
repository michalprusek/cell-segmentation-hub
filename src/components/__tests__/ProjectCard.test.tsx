import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, mockProject } from '@/test/utils/test-utils'
import { ProjectThumbnail } from '@/components/project/ProjectThumbnail'

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

describe('ProjectThumbnail', () => {
  const mockOnDelete = vi.fn()
  const mockOnEdit = vi.fn()

  const defaultProps = {
    project: mockProject,
    onDelete: mockOnDelete,
    onEdit: mockOnEdit,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders project information correctly', () => {
    render(<ProjectThumbnail {...defaultProps} />)
    
    expect(screen.getByText(mockProject.name)).toBeInTheDocument()
    expect(screen.getByText(mockProject.description)).toBeInTheDocument()
    expect(screen.getByText(/created/i)).toBeInTheDocument()
  })

  it('displays correct image count', () => {
    const projectWithImages = {
      ...mockProject,
      images: [
        { id: '1', filename: 'image1.jpg' },
        { id: '2', filename: 'image2.jpg' },
      ],
    }
    
    render(<ProjectThumbnail project={projectWithImages} onDelete={mockOnDelete} onEdit={mockOnEdit} />)
    
    expect(screen.getByText('2 images')).toBeInTheDocument()
  })

  it('shows "No images" when project has no images', () => {
    render(<ProjectThumbnail {...defaultProps} />)
    
    expect(screen.getByText(/no images/i)).toBeInTheDocument()
  })

  it('navigates to project detail on card click', async () => {
    const { useNavigate } = await import('react-router-dom')
    const mockNavigate = vi.fn()
    vi.mocked(useNavigate).mockReturnValue(mockNavigate)
    
    const user = userEvent.setup()
    render(<ProjectThumbnail {...defaultProps} />)
    
    const card = screen.getByRole('article')
    await user.click(card)
    
    expect(mockNavigate).toHaveBeenCalledWith(`/projects/${mockProject.id}`)
  })

  it('opens dropdown menu on button click', async () => {
    const user = userEvent.setup()
    render(<ProjectThumbnail {...defaultProps} />)
    
    const menuButton = screen.getByRole('button', { name: /more options/i })
    await user.click(menuButton)
    
    expect(screen.getByText(/edit/i)).toBeInTheDocument()
    expect(screen.getByText(/delete/i)).toBeInTheDocument()
  })

  it('calls onEdit when edit option is clicked', async () => {
    const user = userEvent.setup()
    render(<ProjectThumbnail {...defaultProps} />)
    
    const menuButton = screen.getByRole('button', { name: /more options/i })
    await user.click(menuButton)
    
    const editButton = screen.getByText(/edit/i)
    await user.click(editButton)
    
    expect(mockOnEdit).toHaveBeenCalledWith(mockProject)
  })

  it('calls onDelete when delete option is clicked', async () => {
    const user = userEvent.setup()
    render(<ProjectThumbnail {...defaultProps} />)
    
    const menuButton = screen.getByRole('button', { name: /more options/i })
    await user.click(menuButton)
    
    const deleteButton = screen.getByText(/delete/i)
    await user.click(deleteButton)
    
    expect(mockOnDelete).toHaveBeenCalledWith(mockProject.id)
  })

  it('displays project thumbnail when available', () => {
    const projectWithThumbnail = {
      ...mockProject,
      thumbnailPath: '/thumbnails/project-thumb.jpg',
    }
    
    render(<ProjectThumbnail project={projectWithThumbnail} onDelete={mockOnDelete} onEdit={mockOnEdit} />)
    
    const thumbnail = screen.getByRole('img', { name: /project thumbnail/i })
    expect(thumbnail).toHaveAttribute('src', projectWithThumbnail.thumbnailPath)
  })

  it('shows placeholder when no thumbnail available', () => {
    render(<ProjectThumbnail {...defaultProps} />)
    
    expect(screen.getByRole('img', { name: /no thumbnail/i })).toBeInTheDocument()
  })

  it('formats creation date correctly', () => {
    const projectWithDate = {
      ...mockProject,
      createdAt: new Date('2023-12-25T10:30:00Z'),
    }
    
    render(<ProjectThumbnail project={projectWithDate} onDelete={mockOnDelete} onEdit={mockOnEdit} />)
    
    expect(screen.getByText(/dec 25, 2023/i)).toBeInTheDocument()
  })

  it('has proper accessibility attributes', () => {
    render(<ProjectThumbnail {...defaultProps} />)
    
    const card = screen.getByRole('article')
    expect(card).toHaveAttribute('tabIndex', '0')
    
    const menuButton = screen.getByRole('button', { name: /more options/i })
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('stops event propagation on menu button click', async () => {
    const user = userEvent.setup()
    const mockCardClick = vi.fn()
    
    render(
      <div onClick={mockCardClick}>
        <ProjectThumbnail {...defaultProps} />
      </div>
    )
    
    const menuButton = screen.getByRole('button', { name: /more options/i })
    await user.click(menuButton)
    
    expect(mockCardClick).not.toHaveBeenCalled()
  })
})