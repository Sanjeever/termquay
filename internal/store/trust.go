package store

type TrustSetting struct {
	Key         string `json:"key"`
	Fingerprint string `json:"fingerprint"`
}

func (s *Store) ImportTrustSettings(values map[string]string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for key, value := range values {
		if _, err := tx.Exec("INSERT INTO settings (id,data) VALUES (?,?) ON CONFLICT (id) DO UPDATE SET data = excluded.data", key, value); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) TrustSettings(after string) ([]TrustSetting, error) {
	rows, err := s.db.Query("SELECT id,data FROM settings WHERE id LIKE 'trust:%' AND data <> '' AND id > ? ORDER BY id LIMIT 257", after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []TrustSetting{}
	for rows.Next() {
		var value TrustSetting
		if err = rows.Scan(&value.Key, &value.Fingerprint); err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}
