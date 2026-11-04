package store

func (s *Store) UpdateSecretSettings(values map[string]string, removed []string) error {
	encoded := make(map[string]string, len(values))
	for key, value := range values {
		ciphertext, err := s.SealSetting(key, value)
		if err != nil {
			return err
		}
		encoded[key] = ciphertext
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for key, value := range encoded {
		if _, err := tx.Exec("INSERT INTO settings (id,data) VALUES (?,?) ON CONFLICT (id) DO UPDATE SET data = excluded.data", key, value); err != nil {
			return err
		}
	}
	for _, key := range removed {
		if _, err := tx.Exec("DELETE FROM settings WHERE id = ?", key); err != nil {
			return err
		}
	}
	return tx.Commit()
}
