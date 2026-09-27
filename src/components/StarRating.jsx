// Accessible 5-star rating. Clicking the current rating clears it.
export default function StarRating({ rating, onRate, label = 'photo', size = 'md' }) {
  return (
    <div className={'star-rating star-rating-' + size} role="group" aria-label={`Rating for ${label}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={'star' + (n <= rating ? ' filled' : '')}
          onClick={(e) => {
            e.stopPropagation()
            onRate(n === rating ? 0 : n)
          }}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          aria-pressed={n <= rating}
          title={n === rating ? 'Clear rating' : `${n} star${n === 1 ? '' : 's'}`}
        >
          ★
        </button>
      ))}
    </div>
  )
}
