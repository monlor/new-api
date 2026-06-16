package system_setting

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

type ThemeSettings struct {
	Frontend             string `json:"frontend"`
	DefaultColorScheme   string `json:"default_color_scheme"`   // system | dark | light
	DefaultPreset        string `json:"default_preset"`
	DefaultFont          string `json:"default_font"`
	DefaultRadius        string `json:"default_radius"`
	DefaultScale         string `json:"default_scale"`
	DefaultContentLayout string `json:"default_content_layout"`
}

var themeSettings = ThemeSettings{
	Frontend:             "classic",
	DefaultColorScheme:   "system",
	DefaultPreset:        "default",
	DefaultFont:          "default",
	DefaultRadius:        "default",
	DefaultScale:         "default",
	DefaultContentLayout: "full",
}

func init() {
	config.GlobalConfig.Register("theme", &themeSettings)
	syncThemeToCommon()
}

func syncThemeToCommon() {
	common.SetTheme(themeSettings.Frontend)
}

func GetThemeSettings() *ThemeSettings {
	return &themeSettings
}

// UpdateAndSyncTheme syncs the theme config to common after DB load.
func UpdateAndSyncTheme() {
	syncThemeToCommon()
}
