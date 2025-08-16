import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, createMockFile, createMockDragEvent } from '@/test/utils/test-utils'
import { ImageUploader } from '@/components/ImageUploader'

// Mock the API client
vi.mock('@/lib/api', () => ({
  api: {
    post: vi.fn(),
  },
}))

describe('ImageUploader', () => {
  const mockOnUpload = vi.fn()
  const mockOnError = vi.fn()

  const defaultProps = {
    projectId: 'test-project-id',
    onUpload: mockOnUpload,
    onError: mockOnError,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders upload area with correct text', () => {
    render(<ImageUploader {...defaultProps} />)
    
    expect(screen.getByText(/drag & drop images here/i)).toBeInTheDocument()
    expect(screen.getByText(/or click to browse/i)).toBeInTheDocument()
  })

  it('accepts image files only', () => {
    render(<ImageUploader {...defaultProps} />)
    
    const input = screen.getByLabelText(/upload images/i)
    expect(input).toHaveAttribute('accept', 'image/*')
  })

  it('handles file selection via input', async () => {
    const user = userEvent.setup()
    render(<ImageUploader {...defaultProps} />)
    
    const file = createMockFile('test.jpg', 'image/jpeg')
    const input = screen.getByLabelText(/upload images/i)
    
    await user.upload(input, file)
    
    expect(input.files).toHaveLength(1)
    expect(input.files[0]).toBe(file)
  })

  it('handles drag and drop events', async () => {
    render(<ImageUploader {...defaultProps} />)
    
    const dropzone = screen.getByRole('button', { name: /upload images/i })
    const file = createMockFile('test.jpg', 'image/jpeg')
    const dragEvent = createMockDragEvent([file])
    
    // Test drag enter
    fireEvent.dragEnter(dropzone, dragEvent)
    expect(dropzone).toHaveClass('border-primary')
    
    // Test drag over
    fireEvent.dragOver(dropzone, dragEvent)
    
    // Test drop
    fireEvent.drop(dropzone, dragEvent)
    
    await waitFor(() => {
      expect(dropzone).not.toHaveClass('border-primary')
    })
  })

  it('rejects non-image files', async () => {
    const user = userEvent.setup()
    render(<ImageUploader {...defaultProps} />)
    
    const textFile = createMockFile('test.txt', 'text/plain')
    const input = screen.getByLabelText(/upload images/i)
    
    await user.upload(input, textFile)
    
    await waitFor(() => {
      expect(mockOnError).toHaveBeenCalledWith(
        expect.stringContaining('Only image files are allowed')
      )
    })
  })

  it('rejects files that are too large', async () => {
    const user = userEvent.setup()
    render(<ImageUploader {...defaultProps} maxSize={1000} />)
    
    const largeFile = createMockFile('large.jpg', 'image/jpeg')
    Object.defineProperty(largeFile, 'size', { value: 2000 })
    
    const input = screen.getByLabelText(/upload images/i)
    
    await user.upload(input, largeFile)
    
    await waitFor(() => {
      expect(mockOnError).toHaveBeenCalledWith(
        expect.stringContaining('File size too large')
      )
    })
  })

  it('shows upload progress during upload', async () => {
    const { api } = await import('@/lib/api')
    const mockPost = api.post as vi.MockedFunction<typeof api.post>
    
    // Mock successful upload
    mockPost.mockResolvedValueOnce({
      data: { success: true, data: { id: 'uploaded-image-id' } }
    })
    
    const user = userEvent.setup()
    render(<ImageUploader {...defaultProps} />)
    
    const file = createMockFile('test.jpg', 'image/jpeg')
    const input = screen.getByLabelText(/upload images/i)
    
    await user.upload(input, file)
    
    // Check if upload progress is shown
    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })
  })

  it('calls onUpload callback on successful upload', async () => {
    const { api } = await import('@/lib/api')
    const mockPost = api.post as vi.MockedFunction<typeof api.post>
    
    const uploadedImage = { id: 'uploaded-image-id', filename: 'test.jpg' }
    mockPost.mockResolvedValueOnce({
      data: { success: true, data: uploadedImage }
    })
    
    const user = userEvent.setup()
    render(<ImageUploader {...defaultProps} />)
    
    const file = createMockFile('test.jpg', 'image/jpeg')
    const input = screen.getByLabelText(/upload images/i)
    
    await user.upload(input, file)
    
    await waitFor(() => {
      expect(mockOnUpload).toHaveBeenCalledWith(uploadedImage)
    })
  })

  it('calls onError callback on upload failure', async () => {
    const { api } = await import('@/lib/api')
    const mockPost = api.post as vi.MockedFunction<typeof api.post>
    
    mockPost.mockRejectedValueOnce(new Error('Upload failed'))
    
    const user = userEvent.setup()
    render(<ImageUploader {...defaultProps} />)
    
    const file = createMockFile('test.jpg', 'image/jpeg')
    const input = screen.getByLabelText(/upload images/i)
    
    await user.upload(input, file)
    
    await waitFor(() => {
      expect(mockOnError).toHaveBeenCalledWith('Upload failed')
    })
  })

  it('supports multiple file uploads', async () => {
    const user = userEvent.setup()
    render(<ImageUploader {...defaultProps} multiple />)
    
    const files = [
      createMockFile('test1.jpg', 'image/jpeg'),
      createMockFile('test2.jpg', 'image/jpeg'),
    ]
    const input = screen.getByLabelText(/upload images/i)
    
    await user.upload(input, files)
    
    expect(input.files).toHaveLength(2)
  })

  it('disables upload when loading', () => {
    render(<ImageUploader {...defaultProps} disabled />)
    
    const button = screen.getByRole('button', { name: /upload images/i })
    expect(button).toBeDisabled()
  })

  it('shows correct file type restrictions in UI', () => {
    render(<ImageUploader {...defaultProps} />)
    
    expect(screen.getByText(/supported formats:/i)).toBeInTheDocument()
    expect(screen.getByText(/jpg, png, gif, bmp/i)).toBeInTheDocument()
  })
})